---
trigger: always_on
---

# Rule: Backend Express Architecture and Serverless Patterns

Maintain these coding patterns across the Node.js infrastructure:
1. **Express Endpoint Boundaries:** Write all core browsing, searching, and file streaming logic inside `/netlify/functions/api.js`. Do not distribute API routes across other arbitrary files.
2. **SPA Fallback Routing:** Ensure `server.js` routes all unmatched browser calls back to `public/index.html` to avoid broken paths during local client testing sessions.
3. **Stream Error Wrappers:** Wrap Google Drive stream pipelines and recursive folder traversals inside robust `try/catch` environments to prevent unhandled rejections from crashing serverless instances.
4. **Response Management:** Use the HTTP compression and cache headers correctly. Match the short TTL patterns for dynamic data assets against the long-lived cache metrics configured in your `netlify.toml` and `vercel.json` routing matrices.
