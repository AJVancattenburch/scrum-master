// A placeholder alone on its line that fills to nothing takes its line with it, so optional sections leave no blank line.
export function renderTemplate(template, vars) {
  return template.replace(/^{{(\w+)}}\n|{{(\w+)}}/gm, (_, lineKey, inlineKey) => {
    const key = lineKey ?? inlineKey;
    if (!(key in vars)) throw new Error(`unfilled placeholder {{${key}}}`);
    if (lineKey === undefined) return vars[key];
    return vars[key] === '' ? '' : `${vars[key]}\n`;
  });
}
