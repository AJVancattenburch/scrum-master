export function renderTemplate(template, vars) {
  return template.replace(/{{(\w+)}}/g, (_, key) => {
    if (!(key in vars)) throw new Error(`unfilled placeholder {{${key}}}`);
    return vars[key];
  });
}
