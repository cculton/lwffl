/* Shared mobile navigation for every site page, including Notebook posts. */
document.querySelectorAll(".topnav").forEach(nav => {
  const inner = nav.querySelector(".nav-inner");
  const links = nav.querySelector(".nav-links");
  if (!inner || !links) return;

  const id = links.id || "site-navigation";
  links.id = id;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "nav-toggle";
  button.setAttribute("aria-controls", id);
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-label", "Open navigation menu");
  button.innerHTML = '<span class="nav-toggle-lines" aria-hidden="true"><span></span><span></span><span></span></span><span class="nav-toggle-text">Menu</span>';
  inner.insertBefore(button, links);
  nav.classList.add("nav-enhanced");

  function setOpen(open) {
    nav.classList.toggle("nav-open", open);
    button.setAttribute("aria-expanded", String(open));
    button.setAttribute("aria-label", open ? "Close navigation menu" : "Open navigation menu");
  }

  button.addEventListener("click", () => setOpen(!nav.classList.contains("nav-open")));
  links.addEventListener("click", event => {
    if (event.target.closest("a")) setOpen(false);
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && nav.classList.contains("nav-open")) {
      setOpen(false);
      button.focus();
    }
  });
  document.addEventListener("click", event => {
    if (!nav.contains(event.target)) setOpen(false);
  });
  window.addEventListener("resize", () => {
    if (window.innerWidth > 760) setOpen(false);
  });
});
