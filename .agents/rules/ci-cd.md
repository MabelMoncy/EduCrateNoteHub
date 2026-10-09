---
trigger: always_on
---

# Rule: CI/CD Monitoring, Local Validation, and Multi-Platform Deployments

When instructed to fix failed GitHub Actions or PR builds:
1. **Pull Logs:** Use the GitHub Actions MCP server to inspect the latest failed workflow. Locate the exact script or endpoint that triggered the error wrapper.
2. **Verify Drive Access:** If the error involves Google Drive connectivity, execute `node test-drive.js` in the terminal to validate the `GOOGLE_SERVICE_ACCOUNT_JSON` formatting and authentication state.
3. **Local Dev Check:** Apply the code fix. Run `npm start` to fire up `server.js` and verify that both static files and the backend proxy boot cleanly without runtime crashes.
4. **Platform Parity:** If modifications are made to server routing, verify that configs match perfectly across both `/netlify/functions/api.js` (for Netlify pathing) and `/api/index.js` (for Vercel pathing).
5. **Commit & Push:** Once verified, push the code with a clean commit message to re-trigger GitHub checks.
