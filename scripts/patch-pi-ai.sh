#!/bin/bash
# Patch pi-ai http-proxy.js to handle missing EnvHttpProxyAgent in Bun
PROXY_FILE="node_modules/@mariozechner/pi-ai/dist/utils/http-proxy.js"
if [ -f "$PROXY_FILE" ]; then
  cat > "$PROXY_FILE" << 'EOF'
if (typeof process !== "undefined" && process.versions?.node) {
    import("undici").then((m) => {
        const { EnvHttpProxyAgent, setGlobalDispatcher } = m;
        if (EnvHttpProxyAgent && setGlobalDispatcher) {
            try {
                setGlobalDispatcher(new EnvHttpProxyAgent());
            } catch (e) {}
        }
    }).catch(() => {});
}
export {};
EOF
fi
