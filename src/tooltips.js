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
    // An open dialog sits above the whole page, so a tooltip for something in it goes in the dialog to be seen.
    appendTo: reference => reference.closest("dialog") || document.body,
    onShow(instance) {
      const text = adoptTitle(instance.reference);
      if (!text) return false;
      instance.setContent(text);
    }
  });
}

// When code sets `title` again on an element that already has a tooltip (e.g. the volume slider while scrolling),
// take the new text right away so an open tooltip updates live and the native one never shows.
function watchTitles(root) {
  new MutationObserver(mutations => {
    for (const { target } of mutations) {
      if (!target._tippy || !target.hasAttribute("title")) continue;
      const text = adoptTitle(target);
      if (text) target._tippy.setContent(text);
      else target._tippy.hide();
    }
  }).observe(root, { attributes: true, attributeFilter: ["title"], subtree: true });
}

export function initTooltips(root = document) {
  watchTitles(root);
  for (const type of ["pointerover", "focusin"]) {
    root.addEventListener(type, event => {
      const element = event.target.closest?.("[title], [data-tip]");
      if (element) attach(element);
    });
  }
}
