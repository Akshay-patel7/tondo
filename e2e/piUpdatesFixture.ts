// A selected pi installation and registry entirely inside a temporary folder.
// Its package manager is the real pinned pi's; only registry responses and self-install writes are stubbed.
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const realPackage = realpathSync(
  path.join(__dirname, "../node_modules/@earendil-works/pi-coding-agent"),
);
const packageRequire = createRequire(path.join(realPackage, "package.json"));
const realCli = path.join(
  realPackage,
  JSON.parse(readFileSync(path.join(realPackage, "package.json"), "utf8")).bin.pi,
);

export function updateFixture(root: string) {
  const packageDir = path.join(root, "pi-package");
  const bin = path.join(root, "commands");
  mkdirSync(bin, { recursive: true });
  mkdirSync(path.join(packageDir, "dist/core"), { recursive: true });
  mkdirSync(path.join(packageDir, "dist/utils"), { recursive: true });
  mkdirSync(path.join(packageDir, "node_modules"));
  symlinkSync(
    path.dirname(packageRequire.resolve("semver/package.json")),
    path.join(packageDir, "node_modules/semver"),
  );
  const piManifest = path.join(packageDir, "package.json");
  writeFileSync(
    piManifest,
    JSON.stringify({
      name: "@earendil-works/pi-coding-agent",
      version: "0.87.1",
      type: "module",
      bin: { pi: "dist/cli.js" },
    }),
  );
  const cli = path.join(packageDir, "dist/cli.js");
  writeFileSync(cli, `import ${JSON.stringify(pathToFileURL(realCli).href)};\n`);
  for (const [file, name] of [
    ["core/package-manager.js", "DefaultPackageManager"],
    ["core/settings-manager.js", "SettingsManager"],
    ["utils/git.js", "parseGitUrl"],
  ]) {
    writeFileSync(
      path.join(packageDir, "dist", file!),
      `export { ${name} } from ${JSON.stringify(pathToFileURL(path.join(realPackage, "dist", file!)).href)};\n`,
    );
  }
  const log = path.join(root, "npm.jsonl");
  const registry = path.join(root, "registry.json");
  writeFileSync(
    registry,
    JSON.stringify({
      "@earendil-works/pi-coding-agent": "0.88.0",
      "test-plugin": "2.0.0",
      "range-plugin@^1": ["1.0.0", "1.2.0"],
      "project-plugin": "3.0.0",
    }),
  );
  const updater = path.join(bin, "registry.cjs");
  writeFileSync(
    updater,
    String.raw`const fs=require('node:fs'),path=require('node:path');
const a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(a)+'\n');
function respond(){
if(fs.existsSync(${JSON.stringify(path.join(root, "fail-registry"))})){console.error('Registry unavailable');process.exit(1);}
if(a[0]==='view'){const v=JSON.parse(fs.readFileSync(${JSON.stringify(registry)},'utf8'))[a[1]];if(!v){console.error('Unknown package');process.exit(1);}console.log(JSON.stringify(v));}
else if(a[0]==='self'){const p=${JSON.stringify(piManifest)};const m=JSON.parse(fs.readFileSync(p,'utf8'));m.version=a[1].slice(a[1].lastIndexOf('@')+1);fs.writeFileSync(p,JSON.stringify(m));}
else if(a[0]==='install'){const prefix=a[a.indexOf('--prefix')+1];const spec=a.find(x=>/^test-plugin@|^range-plugin@|^project-plugin@/.test(x));if(!prefix||!spec)process.exit(2);const i=spec.lastIndexOf('@');const dir=path.join(prefix,'node_modules',spec.slice(0,i));fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name:spec.slice(0,i),version:spec.slice(i+1)}));}
else if(a[0]==='root')console.log(${JSON.stringify(path.join(root, "empty-global-modules"))});
else process.exit(2);
}
if(a[0]==='install'&&fs.existsSync(${JSON.stringify(path.join(root, "block-install"))})){
const watch=fs.watch(${JSON.stringify(root)},()=>{if(fs.existsSync(${JSON.stringify(path.join(root, "release-install"))})){watch.close();respond();}});
fs.writeFileSync(${JSON.stringify(path.join(root, "install-started"))},'');
}else respond();
`,
  );
  const npm = path.join(bin, "npm");
  writeFileSync(npm, `#!${process.execPath}\nrequire(${JSON.stringify(updater)});\n`);
  chmodSync(npm, 0o755);
  writeFileSync(
    path.join(packageDir, "dist/config.js"),
    `export function getSelfUpdateCommand(name, npm, target) { return { command: ${JSON.stringify(process.execPath)}, args: [${JSON.stringify(updater)}, 'self', target] }; }\n`,
  );
  const shell = path.join(bin, "shell");
  writeFileSync(
    shell,
    '#!/bin/sh\nif [ "$1" = "-ilc" ]; then exec /bin/sh -c "$2"; fi\nexec /bin/sh "$@"\n',
  );
  chmodSync(shell, 0o755);
  const env = {
    PATH: `${bin}:${process.env.PATH}`,
    SHELL: shell,
    HOME: path.join(root, "home"),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  mkdirSync(env.HOME, { recursive: true });
  return { cli, packageDir, registry, log, env };
}

export function seedUpdatePackages(agentDir: string): void {
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(
    path.join(agentDir, "settings.json"),
    JSON.stringify({
      packages: [
        "npm:test-plugin",
        { source: "npm:range-plugin@^1", skills: [] },
        "npm:pinned-plugin@1.0.0",
        "./local-plugin",
      ],
    }),
  );
  for (const name of ["test-plugin", "range-plugin", "pinned-plugin"]) {
    const dir = path.join(agentDir, "npm/node_modules", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        name,
        version: "1.0.0",
        pi: { extensions: [], skills: [], prompts: [], themes: [] },
      }),
    );
  }
  mkdirSync(path.join(agentDir, "local-plugin"));
}
