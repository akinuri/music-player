import tippy from "tippy.js";

// Turns every element's `title` into a styled tooltip. Titles are picked up lazily on first hover/focus, and
// re-read on each show, so code can keep setting `element.title` as usual. The native tooltip is suppressed
// by moving the text into `data-tip`.
function adoptTitle(element) {
  if (element.hasAttribute("title")) {
    element.dataset.tip = element.getAttribute("title");
    element.removeAttribute("title");
  }
  return element.dataset.tip || "";
}

function attach(element) {
  adoptTitle(element);
  if (element._tippy) return;
  tippy(element, {
    content: element.dataset.tip,
    theme: "app",
    animation: "shift-away-subtle",
    placement: "top",
    delay: [350, 0],
    duration: [150, 100],
    offset: [0, 8],
    maxWidth: 320,
    touch: ["hold", 500],
    onShow(instance) {
      const text = adoptTitle(instance.reference);
      if (!text) return false;
      instance.setContent(text);
    }
  });
}

export function initTooltips(root = document) {
  for (const type of ["pointerover", "focusin"]) {
    root.addEventListener(type, event => {
      const element = event.target.closest?.("[title], [data-tip]");
      if (element) attach(element);
    });
  }
}
