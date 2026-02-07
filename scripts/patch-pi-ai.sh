#!/bin/bash
# Patch pi-ai http-proxy.js to handle missing EnvHttpProxyAgent in Bun
PATCH_CONTENT='if (typeof process !== "undefined" && process.versions?.node) {
    import("undici").then((m) => {
        const { EnvHttpProxyAgent, setGlobalDispatcher } = m;
        if (EnvHttpProxyAgent && setGlobalDispatcher) {
            try {
                setGlobalDispatcher(new EnvHttpProxyAgent());
            } catch (e) {}
        }
    }).catch(() => {});
}
export {};'

# Patch all copies of http-proxy.js (root and nested inside pi-agent-core)
for PROXY_FILE in \
  "node_modules/@mariozechner/pi-ai/dist/utils/http-proxy.js" \
  "node_modules/@mariozechner/pi-agent-core/node_modules/@mariozechner/pi-ai/dist/utils/http-proxy.js"; do
  if [ -f "$PROXY_FILE" ]; then
    echo "$PATCH_CONTENT" > "$PROXY_FILE"
  fi
done
