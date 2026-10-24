// Renders the popup menu sent by the main process and reports the picked entry.
// Runs sandboxed with menu-preload.cjs; entries are plain data (labels, icon paths, flags).
"use strict";

const root = document.getElementById("menu");
const SVG_NS = "http://www.w3.org/2000/svg";
let token = 0;
/** @type {HTMLButtonElement[]} */
let buttons = [];
let activeIndex = -1;

/**
 * Builds a 15px stroke icon from a 24-unit SVG path.
 * @param {string} d Path data.
 * @returns {SVGSVGElement} Icon element.
 */
function createIcon(d) {
  const svg = document.createElementNS(SVG_NS, "svg");
  for (const [name, value] of Object.entries({ width: "15", height: "15", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round" })) {
    svg.setAttribute(name, value);
  }
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  svg.append(path);
  return svg;
}

/**
 * Highlights one enabled entry (hover or keyboard).
 * @param {number} index Button index, or -1 for none.
 */
function setActive(index) {
  buttons[activeIndex]?.classList.remove("active");
  activeIndex = index;
  buttons[activeIndex]?.classList.add("active");
}

/**
 * Moves the keyboard highlight to the next enabled entry.
 * @param {1 | -1} step Direction.
 */
function moveActive(step) {
  const enabled = buttons.filter((button) => !button.disabled);
  if (!enabled.length) return;
  const current = enabled.indexOf(buttons[activeIndex]);
  const next = enabled[(current + step + enabled.length) % enabled.length];
  setActive(buttons.indexOf(next));
}

/**
 * Renders a menu and reports its size so the main process can fit the view to it.
 * @param {{ token: number, entries: ({ separator: true } | { label: string, icon?: string, hint?: string, danger?: boolean, disabled?: boolean, index: number })[] }} spec Menu.
 */
function render(spec) {
  token = spec.token;
  root.replaceChildren();
  buttons = [];
  activeIndex = -1;
  const hasIcons = spec.entries.some((entry) => "icon" in entry && entry.icon);
  for (const entry of spec.entries) {
    if ("separator" in entry) {
      root.append(document.createElement("hr"));
      continue;
    }
    const button = document.createElement("button");
    button.setAttribute("role", "menuitem");
    button.disabled = Boolean(entry.disabled);
    if (entry.danger) button.classList.add("danger");
    if (hasIcons) {
      const icon = document.createElement("span");
      icon.className = "icon";
      if (entry.icon) icon.append(createIcon(entry.icon));
      button.append(icon);
    }
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = entry.label;
    button.append(label);
    if (entry.hint) {
      const hint = document.createElement("kbd");
      hint.textContent = entry.hint;
      button.append(hint);
    }
    const position = buttons.length;
    button.addEventListener("mouseenter", () => setActive(button.disabled ? -1 : position));
    button.addEventListener("click", () => {
      if (!button.disabled) window.menuHost.select(token, entry.index);
    });
    buttons.push(button);
    root.append(button);
  }
  const rect = root.getBoundingClientRect();
  window.menuHost.resize(token, Math.ceil(rect.width), Math.ceil(rect.height));
}

root.addEventListener("mouseleave", () => setActive(-1));
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") window.menuHost.close(token);
  else if (event.key === "ArrowDown") moveActive(1);
  else if (event.key === "ArrowUp") moveActive(-1);
  else if (event.key === "Enter" && activeIndex >= 0) buttons[activeIndex].click();
  else return;
  event.preventDefault();
});
window.menuHost.onShow(render);
