// Particle class and related functions are included as they are called by setTheme,
// which is essential for the theme switching functionality in the header.
window.setTheme = function(theme) {
  document.body.className = document.body.className.replace(/theme-\w+/g, '') + ' ' + theme + ' transition-all';
  localStorage.setItem('shkspr-theme', theme);
  window.initParticles();
}

window.Particle = class Particle {
  constructor(container, colors) {
    this.container = container;
    this.element = document.createElement('div');
    this.element.classList.add('particle');
    this.container.appendChild(this.element);
    this.size = Math.random() * 6 + 2;
    this.color = colors[Math.floor(Math.random() * colors.length)];
    this.x = Math.random() * window.innerWidth;
    this.y = Math.random() * window.innerHeight;
    this.vx = (Math.random() - 0.5) * 4;
    this.vy = (Math.random() - 0.5) * 4;
    this.opacity = Math.random() * 0.5 + 0.3;
    this.element.style.width = `${this.size}px`;
    this.element.style.height = `${this.size}px`;
    this.element.style.backgroundColor = this.color;
    this.element.style.opacity = this.opacity;
    this.update();
  }
  update() {
    this.x += this.vx;
    this.y += this.vy;
    if (this.x <= 0 || this.x >= window.innerWidth - this.size) {
      this.vx *= -1;
      this.x = this.x <= 0 ? 0 : window.innerWidth - this.size;
    }
    if (this.y <= 0 || this.y >= window.innerHeight - this.size) {
      this.vy *= -1;
      this.y = this.y <= 0 ? 0 : window.innerHeight - this.size;
    }
    this.element.style.transform = `translate(${this.x}px, ${this.y}px)`;
  }
  remove() {
    this.container.removeChild(this.element);
  }
}

let particles = [];
let animationId;

window.initParticles = function() {
  const container = document.getElementById('particles');
  if (!container) return;
  particles.forEach(p => p.remove());
  particles = [];
  if (animationId) {
    cancelAnimationFrame(animationId);
  }
  const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  let colors = [accentColor];
  if (document.body.classList.contains('theme-blackwhite')) {
    colors = [accentColor, '#f0f0f0', '#c0c0c0', '#909090'];
  } else if (document.body.classList.contains('theme-cyan')) {
    colors = [accentColor, '#00e6e6', '#00cccc', '#66ffff'];
  } else if (document.body.classList.contains('theme-purple')) {
    colors = [accentColor, '#ffe6ff', '#cc66ff', '#9933ff'];
  } else if (document.body.classList.contains('theme-green')) {
    colors = [accentColor, '#e6ffe6', '#66ff66', '#33cc33'];
  } else if (document.body.classList.contains('theme-red')) {
    colors = [accentColor, '#ff6666', '#cc0000', '#990000'];
  }
  for (let i = 0; i < 60; i++) {
    particles.push(new window.Particle(container, colors));
  }
  window.animateParticles();
}

window.animateParticles = function() {
  particles.forEach(p => p.update());
  animationId = requestAnimationFrame(window.animateParticles);
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('theme-blackwhite-btn').addEventListener('click', () => window.setTheme('theme-blackwhite'));
    document.getElementById('theme-cyan-btn').addEventListener('click', () => window.setTheme('theme-cyan'));
    document.getElementById('theme-purple-btn').addEventListener('click', () => window.setTheme('theme-purple'));
    document.getElementById('theme-green-btn').addEventListener('click', () => window.setTheme('theme-green'));
    document.getElementById('theme-red-btn').addEventListener('click', () => window.setTheme('theme-red'));

    const savedTheme = localStorage.getItem('shkspr-theme') || 'theme-blackwhite';
    window.setTheme(savedTheme);
});
