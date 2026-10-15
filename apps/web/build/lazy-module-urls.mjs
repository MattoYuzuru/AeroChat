import { dirname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const prefix = "virtual:aerochat-lazy-url/";
const targets = {
  SelfChatPage: "pages/SelfChatPage.tsx",
  CreateGroupPage: "pages/CreateGroupPage.tsx",
  ProfilePage: "pages/ProfilePage.tsx",
  FriendRequestsPage: "pages/FriendRequestsPage.tsx",
  ExplorerPage: "pages/ExplorerPage.tsx",
  PeoplePage: "pages/PeoplePage.tsx",
  PersonProfilePage: "pages/PersonProfilePage.tsx",
  ChatsPage: "pages/ChatsPage.tsx",
  GroupsPage: "pages/GroupsPage.tsx",
  SearchPage: "pages/SearchPage.tsx",
  SettingsPage: "pages/SettingsPage.tsx",
  DesktopShell: "shell/DesktopShell.tsx",
  AppShell: "app/AppShell.tsx",
  MobileLauncherHome: "shell/MobileLauncherHome.tsx",
};

export function lazyModuleUrls(sourceRoot = fileURLToPath(new URL("../src/", import.meta.url))) {
  let isBuild = false;
  const references = new Map();
  return {
    name: "vite-plugin-aerochat-lazy-urls",
    enforce: "post",
    configResolved(config) { isBuild = config.command === "build"; },
    resolveId(id) {
      if (!id.startsWith(prefix)) return;
      if (!Object.hasOwn(targets, id.slice(prefix.length))) this.error("Unknown lazy module URL");
      return "\0" + id;
    },
    load(id) {
      if (!id.startsWith("\0" + prefix)) return;
      const name = id.slice(prefix.length + 1);
      const target = resolve(sourceRoot, targets[name]);
      if (!isBuild) return `export default {url:${JSON.stringify("/@fs/" + target)},resources:null};`;
      const reference = this.emitFile({ type: "chunk", id: target, preserveSignature: "strict" });
      references.set(reference, target);
      return `const url=import.meta.ROLLUP_FILE_URL_${reference};export default {url,resources:url+'.resources.json'};`;
    },
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        for (const reference of references.keys()) {
          const file = this.getFileName(reference);
          const css = new Set();
          const visited = new Set();
          const visit = (name) => {
            if (visited.has(name)) return;
            visited.add(name);
            const chunk = bundle[name];
            if (chunk?.type !== "chunk" || !(chunk.viteMetadata?.importedCss instanceof Set)) {
              this.error("Lazy CSS metadata is unavailable: " + name);
            }
            for (const stylesheet of chunk.viteMetadata.importedCss) {
              if (bundle[stylesheet]?.type !== "asset") this.error("Lazy CSS asset is unavailable");
              css.add(posix.relative(dirname(file), stylesheet));
            }
            for (const dependency of chunk.imports) visit(dependency);
          };
          visit(file);
          if (css.size > 64) this.error("Lazy CSS closure exceeds limit");
          const source = JSON.stringify({ module: posix.basename(file), css: [...css].sort() });
          if (Buffer.byteLength(source) > 16384) this.error("Lazy resources exceed limit");
          this.emitFile({ type: "asset", fileName: file + ".resources.json", source });
        }
      },
    },
  };
}
