/// <reference types="vite/client" />

declare module "virtual:aerochat-lazy-url/*" {
  const resource: { url: string; resources: string | null };
  export default resource;
}
