/**
 * PlaceBot — theme.js
 * Shared dark / light mode toggle for all pages.
 * Persists preference in localStorage under "placebot_theme".
 */
(function () {
    const STORAGE_KEY = "placebot_theme";
    const root = document.documentElement;

    function applyTheme(theme) {
        root.setAttribute("data-theme", theme);
        document.querySelectorAll(".theme-icon").forEach((el) => {
            el.textContent = theme === "dark" ? "🌙" : "☀️";
        });
        localStorage.setItem(STORAGE_KEY, theme);
    }

    function toggle() {
        const current = root.getAttribute("data-theme") || "dark";
        applyTheme(current === "dark" ? "light" : "dark");
    }

    function init() {
        const saved = localStorage.getItem(STORAGE_KEY) || "dark";
        applyTheme(saved);
        document.querySelectorAll(".theme-toggle").forEach((btn) => {
            btn.addEventListener("click", toggle);
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
