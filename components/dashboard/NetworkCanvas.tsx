"use client";

import { useEffect, useRef } from "react";
import type { Vector3 } from "three";

export function NetworkCanvas() {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = container.current;
    if (!host || window.matchMedia("(prefers-reduced-motion: reduce)").matches || window.innerWidth < 720) return;
    let cleanup = () => {};
    let active = true;
    void import("three").then((THREE) => {
      if (!active || !host) return;
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      host.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100); camera.position.z = 7;
      const points = [new THREE.Vector3(-2.4, .7, 0), new THREE.Vector3(.2, 1.3, -.3), new THREE.Vector3(2.2, -.4, .2), new THREE.Vector3(-1.2, -1.1, .5), new THREE.Vector3(.7, -.7, -.2), new THREE.Vector3(1.3, .5, .4), new THREE.Vector3(-.4, .2, .3)];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const neutral = new THREE.Color(0xd8d8dc); const accent = new THREE.Color(0xff4134);
      const colors = new Float32Array(points.length * 3);
      points.forEach((_, index) => (index === 5 ? accent : neutral).toArray(colors, index * 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      const material = new THREE.PointsMaterial({ vertexColors: true, size: .12, transparent: true, opacity: .62 });
      const cloud = new THREE.Points(geometry, material); scene.add(cloud);
      const pairs: Vector3[] = [];
      for (let a = 0; a < points.length; a += 1) for (let b = a + 1; b < points.length; b += 1) if (points[a].distanceTo(points[b]) < 3.4) pairs.push(points[a], points[b]);
      const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pairs), new THREE.LineBasicMaterial({ color: 0x67676d, transparent: true, opacity: .16 })); scene.add(lines);
      const resize = () => { const width = host.clientWidth, height = host.clientHeight; renderer.setSize(width, height, false); camera.aspect = width / Math.max(height, 1); camera.updateProjectionMatrix(); };
      const observer = new ResizeObserver(resize); observer.observe(host); resize();
      let raf = 0; const start = performance.now(); let visible = true;
      const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible && !raf) tick(); }); intersection.observe(host);
      const tick = () => { if (!visible) { raf = 0; return; } const time = (performance.now() - start) / 1000; cloud.rotation.z = time * .025; lines.rotation.z = time * .025; cloud.rotation.y = Math.sin(time * .18) * .08; lines.rotation.y = cloud.rotation.y; renderer.render(scene, camera); raf = requestAnimationFrame(tick); }; tick();
      cleanup = () => { active = false; cancelAnimationFrame(raf); observer.disconnect(); intersection.disconnect(); geometry.dispose(); material.dispose(); renderer.dispose(); renderer.domElement.remove(); };
    });
    return () => { active = false; cleanup(); };
  }, []);
  return <div className="network-canvas" ref={container} aria-hidden="true" />;
}
