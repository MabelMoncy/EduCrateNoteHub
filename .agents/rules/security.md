---
trigger: always_on
---

# Rule: Security Guardrails, Data Sanitization, and Credential Hardening

Act as an expert Application Security Engineer. Enforce these strict controls across the application:
1. **Google Drive ID Checks:** Every route parameter pulling a folder or file ID must be strictly validated against the official regex: `^[a-zA-Z0-9_-]{8,200}$`.
2. **Content Protection:** Ensure Helmet configurations and strict Content Security Policies (CSP) are maintained in the backend API to manage safe image and script execution sources.
3. **CORS Restrictions:** When modifying endpoints, ensure the runtime origin check utilizes the `ALLOWED_ORIGINS` environment variables and falls back cleanly to a same-host protocol match.
4. **Manual Security Validation:** After modifying input sanitization, HTML escaping logic, or server parameters, execute `node security-test.js` in the terminal to ensure all baseline console diagnostics pass.
5. **Asset Guarding:** Ensure file transfers implement explicit PDF MIME validation and observe the `FUNCTION_MAX_RESPONSE_BYTES` inline size threshold to prevent serverless execution timeout errors.
