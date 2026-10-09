---
trigger: always_on
---

# Rule: Frontend Architecture and Tailwind CSS Theme Standards

Enforce these strict UI/UX style guidelines for the client dashboard:
1. **Tailwind Processing:** Use Tailwind CSS utility classes exclusively within the `public/` directory files. Let PostCSS and Autoprefixer compile output styles automatically.
2. **Theme State Preservation:** Maintain the class-based dark mode design setup. Ensure code reads and saves states securely using `localStorage.theme` while respecting the system preference fallback.
3. **Meta State Updates:** Ensure client script modifications dynamically update the `<meta name="theme-color">` values alongside layout changes.
4. **Asset Directory Management:** Keep the `/public` root folder organized. Serve only static frontend entry-points, asset images, sitemaps, and precompiled inline style elements.
