/**
 * In-browser 3D preview of a marketplace listing.
 *
 * Fetches a downsampled STL from `/api/marketplace/{jobId}/preview-mesh`
 * (server returns a coarsened mesh — recognisable silhouette but
 * useless as a print substitute) and renders it with three.js +
 * an orbit-style camera that auto-rotates by default and lets the
 * user click-drag to inspect.
 *
 * Lean on purpose: no react-three-fiber, no drei. Just raw three.js
 * with a tiny manual STL parser (binary STL is ~30 lines). Total
 * bundle impact ~250 KB gzipped (vs ~800 KB with R3F + drei).
 */

import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";

import { API } from "../../lib/api";

/**
 * Minimal binary STL parser. The server only ever emits binary STL
 * for previews so we don't need ASCII support. Spec:
 *   80 byte header
 *   uint32 little-endian triangle count
 *   for each triangle: 12 floats (normal xyz + 3 verts xyz) + uint16 attr
 */
const parseBinarySTL = (buffer) => {
  const view = new DataView(buffer);
  const triCount = view.getUint32(80, true);
  const positions = new Float32Array(triCount * 9);
  const normals = new Float32Array(triCount * 9);
  let offset = 84;
  let posIdx = 0;
  let normIdx = 0;
  for (let i = 0; i < triCount; i++) {
    const nx = view.getFloat32(offset, true);
    const ny = view.getFloat32(offset + 4, true);
    const nz = view.getFloat32(offset + 8, true);
    offset += 12;
    for (let v = 0; v < 3; v++) {
      positions[posIdx++] = view.getFloat32(offset, true);
      positions[posIdx++] = view.getFloat32(offset + 4, true);
      positions[posIdx++] = view.getFloat32(offset + 8, true);
      normals[normIdx++] = nx;
      normals[normIdx++] = ny;
      normals[normIdx++] = nz;
      offset += 12;
    }
    offset += 2; // attribute byte count (ignored)
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  return geom;
};

export const Lithophane3DPreview = ({ jobId, height = 480 }) => {
  const containerRef = useRef(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error

  useEffect(() => {
    if (!jobId) return undefined;

    const container = containerRef.current;
    if (!container) return undefined;

    let cancelled = false;
    let frameHandle = 0;

    // --- three.js scaffolding ---
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a);

    const camera = new THREE.PerspectiveCamera(
      40, container.clientWidth / height, 0.1, 2000,
    );
    camera.position.set(0, 0, 200);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, height);
    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    // Lighting: a rim + key + soft ambient so color-flat meshes still
    // read as 3D shapes.
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(2, 3, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xa3c4ff, 0.6);
    rim.position.set(-3, -2, 2);
    scene.add(rim);

    // --- camera orbit state (no OrbitControls dep) ---
    // Spherical coords around the model's center.
    let theta = Math.PI * 0.25;  // azimuth
    let phi = Math.PI * 0.35;    // elevation
    let radius = 250;
    let center = new THREE.Vector3(0, 0, 0);
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let rotationActive = true;

    const updateCamera = () => {
      const sinPhi = Math.sin(phi);
      camera.position.set(
        center.x + radius * sinPhi * Math.cos(theta),
        center.y + radius * sinPhi * Math.sin(theta),
        center.z + radius * Math.cos(phi),
      );
      camera.up.set(0, 0, 1);
      camera.lookAt(center);
    };
    updateCamera();

    const onPointerDown = (e) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      rotationActive = false; // user took over
    };
    const onPointerUp = () => {
      dragging = false;
    };
    const onPointerMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      theta -= dx * 0.01;
      phi = Math.max(0.1, Math.min(Math.PI - 0.1, phi - dy * 0.01));
      updateCamera();
    };
    const onWheel = (e) => {
      e.preventDefault();
      radius = Math.max(50, Math.min(800, radius * (1 + e.deltaY * 0.0015)));
      updateCamera();
    };

    const canvas = renderer.domElement;
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    // --- render loop ---
    const tick = () => {
      if (cancelled) return;
      if (rotationActive) {
        theta += 0.004;
        updateCamera();
      }
      renderer.render(scene, camera);
      frameHandle = requestAnimationFrame(tick);
    };

    // --- mesh load ---
    let mesh = null;
    (async () => {
      try {
        const res = await fetch(`${API}/marketplace/${jobId}/preview-mesh`);
        if (!res.ok) throw new Error(`preview-mesh ${res.status}`);
        const buf = await res.arrayBuffer();
        if (cancelled) return;

        const geom = parseBinarySTL(buf);
        geom.computeBoundingBox();
        const bb = geom.boundingBox;
        // Center the mesh on its bounding box so orbits look natural.
        const c = new THREE.Vector3();
        bb.getCenter(c);
        geom.translate(-c.x, -c.y, -c.z);

        // Re-compute the bounding box on the *centered* geometry so the
        // camera-fit math below uses the right extent.
        geom.computeBoundingBox();
        const size = new THREE.Vector3();
        geom.boundingBox.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        // Pull the camera back to fit the whole bound nicely.
        radius = maxDim * 2.4;
        center = new THREE.Vector3(0, 0, 0);
        updateCamera();

        const mat = new THREE.MeshStandardMaterial({
          color: 0xe7e5e4,
          metalness: 0.05,
          roughness: 0.55,
          side: THREE.DoubleSide,
        });
        mesh = new THREE.Mesh(geom, mat);
        scene.add(mesh);

        setStatus("ready");
        tick();
      } catch (e) {
        console.warn("[Lithophane3DPreview] failed to load mesh", e);
        if (!cancelled) setStatus("error");
      }
    })();

    // --- resize ---
    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      camera.aspect = w / height;
      camera.updateProjectionMatrix();
      renderer.setSize(w, height);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelled = true;
      if (frameHandle) cancelAnimationFrame(frameHandle);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("wheel", onWheel);
      if (mesh) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      renderer.dispose();
      if (canvas.parentNode === container) container.removeChild(canvas);
    };
    // We intentionally exclude rotationActive — it's an internal
    // ref-like flag manipulated by drag events, not React state.
  }, [jobId, height]);

  return (
    <div
      className="relative w-full bg-zinc-950 border-b border-zinc-800"
      data-testid="lithophane-3d-preview"
    >
      <div
        ref={containerRef}
        className="w-full"
        style={{ height }}
        data-testid="lithophane-3d-canvas-container"
      />
      {status === "loading" && (
        <div
          className="absolute inset-0 flex items-center justify-center font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500 pointer-events-none"
          data-testid="3d-preview-loading"
        >
          Loading 3D preview…
        </div>
      )}
      {status === "error" && (
        <div
          className="absolute inset-0 flex items-center justify-center font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600 pointer-events-none"
          data-testid="3d-preview-error"
        >
          3D preview unavailable
        </div>
      )}
      <div className="absolute bottom-2 left-2 font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-600 pointer-events-none">
        Drag · scroll to zoom · low-res preview
      </div>
    </div>
  );
};
