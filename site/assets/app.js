const reveals = document.querySelectorAll('.reveal');

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }
  },
  { threshold: 0.16 },
);

for (const el of reveals) observer.observe(el);

for (const trigger of document.querySelectorAll('[data-copy]')) {
  trigger.addEventListener('click', () => {
    void copyTriggerValue(trigger);
  });
}

async function copyTriggerValue(trigger) {
  const value = trigger.getAttribute('data-copy');
  if (!value || !navigator.clipboard) return;
  await navigator.clipboard.writeText(value);
  const old = trigger.textContent;
  trigger.textContent = trigger.getAttribute('data-copied') || 'Copied';
  window.setTimeout(() => {
    trigger.textContent = old;
  }, 1400);
}
