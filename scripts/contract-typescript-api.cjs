#!/usr/bin/env node
// Resolve only the public entry point; include overloads, fields and namespace exports.
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'sdks/typescript/node_modules/typescript'));
const configFile = ts.readConfigFile(path.join(root, 'sdks/typescript/tsconfig.json'), ts.sys.readFile);
const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.join(root, 'sdks/typescript'));
const program = ts.createProgram(config.fileNames, config.options);
const checker = program.getTypeChecker();
const entry = program.getSourceFile(path.join(root, 'sdks/typescript/src/index.ts'));
const flags = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;
const result = [];
function resolve(s) { return s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s; }
function visible(d) {
  if (ts.getJSDocTags(d).some(tag => tag.tagName.text === 'internal')) return false;
  return !(d.name && ts.isPrivateIdentifier(d.name)) && !(ts.getCombinedModifierFlags(d) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected));
}
function add(key, symbol, declaration) {
  const d = declaration || symbol.valueDeclaration || symbol.declarations?.[0];
  if (!d) return;
  let signatures = [];
  if (ts.isFunctionDeclaration(d) || ts.isMethodDeclaration(d) || ts.isMethodSignature(d)
      || ts.isConstructorDeclaration(d) || ts.isCallSignatureDeclaration(d) || ts.isConstructSignatureDeclaration(d)) {
    const sig = checker.getSignatureFromDeclaration(d);
    if (sig) signatures = [checker.signatureToString(sig, d, flags)];
  }
  const type = checker.getTypeOfSymbolAtLocation(symbol, d);
  result.push({ key, signature: signatures[0] || (ts.isInterfaceDeclaration(d) ? "interface " + d.name.text : ts.isTypeAliasDeclaration(d) ? d.type.getText().replace(/\s+/g, " ") : checker.typeToString(type, d, flags)),
    source: path.relative(root, d.getSourceFile().fileName).split(path.sep).join('/'),
    optional: !!(symbol.flags & ts.SymbolFlags.Optional),
    readonly: !!(ts.getCombinedModifierFlags(d) & ts.ModifierFlags.Readonly),
    static: !!(ts.getCombinedModifierFlags(d) & ts.ModifierFlags.Static) });
}
for (const exported of checker.getExportsOfModule(checker.getSymbolAtLocation(entry))) {
  const name = exported.getName(), s = resolve(exported), declarations = s.declarations || [];
  const d = s.valueDeclaration || declarations[0];
  if (!d) continue;
  add(name, s);
  const classOrInterface = (ts.isVariableDeclaration(d) && d.initializer && ts.isClassExpression(d.initializer) ? d.initializer : undefined)
    || declarations.find(x => ts.isClassDeclaration(x) || ts.isInterfaceDeclaration(x));
  if (classOrInterface) {
    for (const m of classOrInterface.members) {
      if (!visible(m)) continue;
      if (ts.isMethodDeclaration(m) && m.body && classOrInterface.members.some(other => other !== m
        && ts.isMethodDeclaration(other) && !other.body && other.name.getText() === m.name.getText())) continue;
      if (ts.isConstructorDeclaration(m)) {
        const sig = checker.getSignatureFromDeclaration(m);
        result.push({ key: name + '.new', signature: checker.signatureToString(sig, m, flags), source: path.relative(root, m.getSourceFile().fileName).split(path.sep).join('/') });
      } else if (m.name) {
        const sym = checker.getSymbolAtLocation(m.name);
        if (sym) add(name + '.' + m.name.getText().replace(/^['"]|['"]$/g, ''), sym, m);
      }
    }
    if (ts.isClassDeclaration(classOrInterface) && !classOrInterface.members.some(ts.isConstructorDeclaration)) {
      for (const sig of checker.getTypeOfSymbolAtLocation(s, classOrInterface).getConstructSignatures()) {
        result.push({ key: name + '.new', signature: checker.signatureToString(sig, classOrInterface, flags),
          source: path.relative(root, classOrInterface.getSourceFile().fileName).split(path.sep).join('/') });
      }
    }
    const inheritedType = ts.isClassExpression(classOrInterface)
      ? checker.getTypeOfSymbolAtLocation(s, d).getConstructSignatures()[0]?.getReturnType()
      : checker.getDeclaredTypeOfSymbol(s);
    for (const member of inheritedType ? checker.getPropertiesOfType(inheritedType) : []) {
      const decl = member.valueDeclaration || member.declarations?.[0];
      const memberName = decl?.name?.getText().replace(/^['"]|['"]$/g, '') ?? member.getName();
      if (decl && visible(decl) && decl.getSourceFile().fileName.startsWith(path.join(root, 'sdks/typescript/src'))
        && !result.some(row => row.key === name + '.' + memberName)) add(name + '.' + memberName, member, decl);
    }
  } else if (s.flags & ts.SymbolFlags.Module) {
    for (const member of checker.getExportsOfModule(s)) add(name + '.' + member.getName(), resolve(member));
  } else if (ts.isTypeAliasDeclaration(d)) {
    const type = checker.getDeclaredTypeOfSymbol(s);
    if (!(type.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.Union))) {
      for (const member of checker.getPropertiesOfType(type)) add(name + '.' + member.getName(), member);
    }
  }
}
const unique = new Map(result.map(x => [x.key + '\0' + x.signature, x]));
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
process.stdout.write(JSON.stringify([...unique.values()].sort((a, b) => compare(a.key, b.key) || compare(a.signature, b.signature)), null, 2) + '\n');
