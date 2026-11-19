#!/usr/bin/env node
// Summarizes a Snowflake EXPLAIN result export (TSV or CSV) so plans never get pasted into chat.
// Usage: node bin/explain-summary.mjs <plan-file> [baseline-plan-file]
import { readFileSync } from "node:fs";

function parseCsv(text) {
	const rows = [];
	let row = [];
	let field = "";
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quoted) {
			if (c === '"' && text[i + 1] === '"') {
				field += '"';
				i++;
			} else if (c === '"') quoted = false;
			else field += c;
		} else if (c === '"') quoted = true;
		else if (c === ",") {
			row.push(field);
			field = "";
		} else if (c === "\n") {
			row.push(field.replace(/\r$/, ""));
			rows.push(row);
			row = [];
			field = "";
		} else field += c;
	}
	if (field || row.length) rows.push([...row, field]);
	return rows;
}

function load(path) {
	let text;
	try {
		text = readFileSync(path, "utf8");
	} catch (err) {
		console.error(`explain-summary: cannot read ${path}: ${err.message}`);
		process.exit(2);
	}
	const firstLine = text.split("\n", 1)[0];
	const rows = firstLine.includes("\t")
		? text.split("\n").filter(Boolean).map((l) => l.replace(/\r$/, "").split("\t"))
		: parseCsv(text);
	const header = rows[0].map((h) => h.trim().toLowerCase());
	const col = (name) => {
		const i = header.indexOf(name.toLowerCase());
		if (i < 0) {
			console.error(`explain-summary: ${path} has no "${name}" column (got: ${header.join(", ")})`);
			process.exit(2);
		}
		return i;
	};
	const [op, obj, expr, pTotal, pAssigned, bytes] = [
		"operation", "objects", "expressions", "partitionsTotal", "partitionsAssigned", "bytesAssigned",
	].map(col);
	const plan = { global: null, scans: new Map(), sortKeys: [] };
	for (const r of rows.slice(1)) {
		const num = (i) => Number(r[i] || 0);
		if (r[op] === "GlobalStats") plan.global = { total: num(pTotal), assigned: num(pAssigned), bytes: num(bytes) };
		else if (r[op] === "TableScan") {
			const s = plan.scans.get(r[obj]) ?? { reads: 0, partitions: 0, total: 0, bytes: 0 };
			s.reads++;
			s.partitions += num(pAssigned);
			s.total += num(pTotal);
			s.bytes += num(bytes);
			plan.scans.set(r[obj], s);
		} else if (/sortKey:/.test(r[expr] ?? "") && /^SortWithLimit$/.test(r[op])) plan.sortKeys.push(r[expr]);
	}
	if (!plan.global) {
		console.error(`explain-summary: ${path} has no GlobalStats row`);
		process.exit(2);
	}
	return plan;
}

const mb = (b) => (b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`);
const [planPath, basePath] = process.argv.slice(2);
if (!planPath) {
	console.error("usage: node bin/explain-summary.mjs <plan-file> [baseline-plan-file]");
	process.exit(2);
}
const plan = load(planPath);
const base = basePath ? load(basePath) : null;
const g = plan.global;
console.log(`GlobalStats: ${g.assigned}/${g.total} partitions, ${mb(g.bytes)}` +
	(base ? ` (baseline ${base.global.assigned}/${base.global.total}, ${mb(base.global.bytes)})` : ""));
for (const [name, s] of [...plan.scans].sort((a, b) => b[1].bytes - a[1].bytes)) {
	const prior = base?.scans.get(name);
	const tag = !base ? "" : !prior ? "  NEW" : prior.reads !== s.reads ? `  reads ${prior.reads}->${s.reads}` : "";
	const full = s.partitions === s.total && s.total > 1 ? " full" : "";
	console.log(`  ${name}: ${s.reads}x, ${s.partitions}/${s.total} partitions${full}, ${mb(s.bytes)}${tag}`);
}
if (base) for (const name of base.scans.keys()) if (!plan.scans.has(name)) console.log(`  ${name}: GONE`);
for (const k of plan.sortKeys) {
	const terms = k.replace(/^.*sortKey: \[|\],.*$/g, "").split(/, (?![^(]*\))/);
	const dupes = terms.filter((t, i) => terms.indexOf(t) !== i);
	console.log(`  sort: ${terms.length} terms${dupes.length ? `, DUPLICATE ${[...new Set(dupes)].join("; ")}` : ""}`);
}
