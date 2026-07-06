import React from "react";
import { Slider } from "../../ui/slider";
import { Label } from "../../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import { Input } from "../../ui/input";
import { ModeToggle } from "./ModeToggle";
import { ImageEditPanel } from "./ImageEditPanel";
import { PresetManager } from "./PresetManager";
import { HelpHint } from "./HelpHint";
import { PrinterSelect } from "./PrinterSelect";
import { NozzleSelect } from "./NozzleSelect";

const Row = ({ label, value, unit, children, testid, hint }) => (
  <div className="space-y-2" data-testid={testid}>
    <div className="flex items-center justify-between">
      <Label className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
        {label}
      </Label>
      <span className="font-mono text-xs text-zinc-300 tabular-nums">
        {value}
        <span className="text-zinc-600 ml-1">{unit}</span>
      </span>
    </div>
    {children}
    {hint && (
      <div
        className="text-[9px] font-mono text-zinc-500 leading-tight pt-0.5"
        data-testid={testid ? `${testid}-hint` : undefined}
      >
        {hint}
      </div>
    )}
  </div>
);

export const ConfigPanel = ({
  config,
  setConfig,
  disabled,
  paletteLength = 6,
  edits,
  setEdits,
  hasImage,
  originalImg,
  filaments,
  setFilaments,
  vibrancy,
  setVibrancy,
}) => {
  const update = (key, v) => setConfig((c) => ({ ...c, [key]: v }));
  const isPainting = config.render_mode === "painting";
  const isDisc = config.geometry === "disc";
  const isBox = config.geometry === "box";
  // For sizing the lithophane footprint: box-round and disc both
  // collapse the form to a single Diameter slider.
  const isRoundLitho = isDisc || (isBox && config.box_shape === "round");

  // ---- Nozzle → layer-height constraints --------------------------------
  // Practical window is 25%–80% of nozzle Ø: below 25% extrusion gets
  // inconsistent, above 80% layers no longer bond reliably.
  const ALL_LAYER_HEIGHTS = [
    0.06, 0.08, 0.1, 0.12, 0.16, 0.2, 0.24, 0.28, 0.32, 0.4, 0.48, 0.56, 0.64,
  ];
  const nozzle = config.nozzle_mm ?? 0.4;
  const lhMin = +(nozzle * 0.25).toFixed(3);
  const lhMax = +(nozzle * 0.8).toFixed(3);
  const layerOptions = ALL_LAYER_HEIGHTS.filter(
    (h) => h >= lhMin - 1e-9 && h <= lhMax + 1e-9,
  );
  const lhLabel = (h) =>
    h <= 0.08 ? "fine" : h <= 0.16 ? "standard" : h <= 0.24 ? "draft" : "coarse";

  // Snap layer height into the nozzle's window whenever the nozzle changes.
  React.useEffect(() => {
    if (!layerOptions.length) return;
    const current = config.layer_height_mm;
    if (!layerOptions.some((h) => Math.abs(h - current) < 1e-9)) {
      const nearest = layerOptions.reduce((a, b) =>
        Math.abs(b - current) < Math.abs(a - current) ? b : a,
      );
      update("layer_height_mm", nearest);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nozzle]);

  // Hard cap is 7 swaps (= 8 filaments). The palette can grow to match
  // via `growPaletteTo` below, so the slider isn't artificially limited
  // by the user's current palette size.
  const swapsMax = 7;

  // Pull more filaments from the backend default list to fill the palette
  // up to `target` items (skips any name already present so the user's
  // edits aren't clobbered).
  const growPaletteTo = async (target) => {
    if (!setFilaments) return;
    if (filaments.length >= target) return;
    try {
      const { getDefaultFilaments } = await import("../lib/api");
      const defaults = await getDefaultFilaments();
      setFilaments((curr) => {
        if (curr.length >= target) return curr;
        const namesSeen = new Set(curr.map((f) => f.name.toLowerCase()));
        const extras = defaults.filter(
          (f) => !namesSeen.has(f.name.toLowerCase()),
        );
        const next = [...curr];
        while (next.length < target && extras.length > 0) {
          next.push(extras.shift());
        }
        return next;
      });
    } catch {
      /* no-op — if defaults can't load, slider clamps naturally */
    }
  };

  const handleSwapsChange = (v) => {
    update("max_swaps", v);
    if (v + 1 > filaments.length) growPaletteTo(v + 1);
  };

  return (
    <div
      className="h-full overflow-y-auto p-5 space-y-6"
      data-testid="config-panel"
    >
      {setFilaments && (
        <>
          <PresetManager
            config={config}
            setConfig={setConfig}
            filaments={filaments}
            setFilaments={setFilaments}
            edits={edits}
            setEdits={setEdits}
            vibrancy={vibrancy}
            setVibrancy={setVibrancy}
            disabled={disabled}
          />
          <div className="border-t border-zinc-800" />
        </>
      )}

      {hasImage && edits && setEdits && (
        <>
          <ImageEditPanel
            edits={edits}
            setEdits={setEdits}
            disabled={disabled}
            image={originalImg}
          />
          <div className="border-t border-zinc-800" />
        </>
      )}

      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500 mb-3 flex items-center gap-1.5">
          Render mode
          <HelpHint title="Lithophane vs Painting" testId="help-render-mode">
            <strong className="text-zinc-200">Lithophane</strong> uses
            Beer-Lambert subtractive mixing — colors emerge from light
            passing through stacked translucent layers. Requires a
            back-light to view properly.
            <br /><br />
            <strong className="text-zinc-200">Painting</strong> maps each
            pixel to a single solid filament on top. No back-light needed,
            high-contrast colors, but cannot mix to in-between hues.
          </HelpHint>
        </div>
        <ModeToggle
          mode={config.render_mode}
          setMode={(m) => update("render_mode", m)}
          disabled={disabled}
        />
        <div className="font-mono text-[9px] text-zinc-600 leading-relaxed mt-2">
          {isPainting
            ? "Each pixel shows one filament's pure color — no back-light needed. Dark filaments print at the bottom, light on top."
            : "Color comes from light transmitted through the stack. Needs a back-light. Full CMYKW subtractive mixing."}
        </div>
      </div>

      <div className="border-t border-zinc-800" />

      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500 mb-3 flex items-center gap-1.5">
          Geometry
          <HelpHint title="Geometry" testId="help-geometry">
            <strong className="text-zinc-200">Width × Height</strong> set
            the print's physical dimensions in mm.
            <br /><br />
            <strong className="text-zinc-200">Thickness</strong> is the
            total Z height — more thickness = more layers = better color
            depth (lithophane mode), but longer print time.
            <br /><br />
            <strong className="text-zinc-200">Shape</strong>: flat works
            for any printer; curved/cylindrical require the matching
            print bed orientation; circular disc gives a round print
            (with optional gentle dome).
          </HelpHint>
        </div>
        <div className="space-y-4">
          <div>
            <Label className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 mb-2 block">
              Target printer
            </Label>
            <PrinterSelect
              value={config.printer_id}
              onChange={(v) => update("printer_id", v)}
              disabled={disabled}
              testId="config-printer-select"
            />
            <div className="font-mono text-[9px] text-zinc-600 mt-1 leading-relaxed">
              Drives bed size, layer-change G-code (M600 vs AMS tool change),
              and which export formats are recommended.
            </div>
          </div>

          <div>
            <Label className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 mb-2 block">
              Nozzle
            </Label>
            <NozzleSelect
              printerId={config.printer_id}
              value={config.nozzle_mm ?? 0.4}
              onChange={(v) => update("nozzle_mm", v)}
              disabled={disabled}
              testId="config-nozzle-select"
            />
            <div
              className={`font-mono text-[9px] mt-1 leading-relaxed ${
                nozzle >= 0.6 ? "text-amber-400" : "text-zinc-600"
              }`}
              data-testid="nozzle-detail-hint"
            >
              {nozzle >= 0.6
                ? "Large nozzle — fine image detail will be lost in the print."
                : nozzle <= 0.25
                  ? "Small nozzle — maximum detail, but much longer print time."
                  : `Allows ${lhMin.toFixed(2)}–${lhMax.toFixed(2)} mm layers. Written into the 3MF.`}
            </div>
          </div>

          <div>
            <Label className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 mb-2 block">
              Shape
            </Label>
            <Select
              value={config.geometry}
              onValueChange={(v) => update("geometry", v)}
              disabled={disabled}
            >
              <SelectTrigger
                data-testid="geometry-select"
                className="rounded-none bg-zinc-950 border-zinc-800 font-mono text-xs h-9"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-none bg-zinc-950 border-zinc-800">
                <SelectItem value="flat" className="font-mono text-xs rounded-none">
                  Flat rectangle
                </SelectItem>
                <SelectItem value="curved" className="font-mono text-xs rounded-none">
                  Curved panel
                </SelectItem>
                <SelectItem
                  value="cylindrical"
                  className="font-mono text-xs rounded-none"
                >
                  Cylindrical
                </SelectItem>
                <SelectItem
                  value="disc"
                  className="font-mono text-xs rounded-none"
                >
                  Circular disc
                </SelectItem>
                <SelectItem
                  value="box"
                  className="font-mono text-xs rounded-none"
                >
                  Lightbox (rect / round)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isBox && (
            <div
              className="space-y-3 border border-amber-700/30 bg-amber-950/10 p-3"
              data-testid="lightbox-config"
            >
              <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-amber-200/80 flex items-center gap-1.5">
                Lightbox enclosure
                <HelpHint title="Lightbox" testId="help-lightbox">
                  <strong className="text-zinc-200">Box mode</strong>
                  prints the lithophane PLUS a separate enclosure
                  (frame + slide-in back panel + optional diffuser).
                  Use a puck-style LED or string LEDs inside.
                  <br /><br />
                  Lithophane prints first. Then print the lightbox
                  frame standing on its FRONT face for the smoothest
                  bezel. The back panel friction-fits into the cavity.
                  <br /><br />
                  Cable-exit notch is a fixed 6 mm gap at the bottom
                  rear of the back panel.
                </HelpHint>
              </div>
              <div>
                <Label className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 mb-2 block">
                  Box shape
                </Label>
                <Select
                  value={config.box_shape ?? "rect"}
                  onValueChange={(v) => update("box_shape", v)}
                  disabled={disabled}
                >
                  <SelectTrigger
                    data-testid="box-shape-select"
                    className="rounded-none bg-zinc-950 border-zinc-800 font-mono text-xs h-9"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-none bg-zinc-950 border-zinc-800">
                    <SelectItem value="rect" className="font-mono text-xs rounded-none">
                      Rectangle
                    </SelectItem>
                    <SelectItem value="round" className="font-mono text-xs rounded-none">
                      Round
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Row
                label={config.box_shape === "round" ? "Outer Ø" : "Outer width"}
                value={config.box_outer_w_mm ?? 110}
                unit="mm"
                testid="row-box-outer-w"
              >
                <Slider
                  data-testid="box-outer-w-slider"
                  value={[config.box_outer_w_mm ?? 110]}
                  onValueChange={([v]) => {
                    if (config.box_shape === "round") {
                      setConfig((c) => ({ ...c, box_outer_w_mm: v, box_outer_h_mm: v }));
                    } else {
                      update("box_outer_w_mm", v);
                    }
                  }}
                  min={60}
                  max={320}
                  step={1}
                  disabled={disabled}
                />
              </Row>

              {config.box_shape !== "round" && (
                <Row
                  label="Outer height"
                  value={config.box_outer_h_mm ?? 110}
                  unit="mm"
                  testid="row-box-outer-h"
                >
                  <Slider
                    data-testid="box-outer-h-slider"
                    value={[config.box_outer_h_mm ?? 110]}
                    onValueChange={([v]) => update("box_outer_h_mm", v)}
                    min={60}
                    max={320}
                    step={1}
                    disabled={disabled}
                  />
                </Row>
              )}

              <Row
                label="Box depth"
                value={config.box_depth_mm ?? 35}
                unit="mm"
                testid="row-box-depth"
                hint="Depth of the cavity that holds the LED. 25–50 mm is typical for diffuse glow."
              >
                <Slider
                  data-testid="box-depth-slider"
                  value={[config.box_depth_mm ?? 35]}
                  onValueChange={([v]) => update("box_depth_mm", v)}
                  min={20}
                  max={80}
                  step={1}
                  disabled={disabled}
                />
              </Row>

              <Row
                label="Wall thickness"
                value={(config.box_wall_mm ?? 3).toFixed(1)}
                unit="mm"
                testid="row-box-wall"
              >
                <Slider
                  data-testid="box-wall-slider"
                  value={[config.box_wall_mm ?? 3]}
                  onValueChange={([v]) => update("box_wall_mm", v)}
                  min={2}
                  max={6}
                  step={0.5}
                  disabled={disabled}
                />
              </Row>

              <div>
                <Label className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 mb-2 block">
                  LED mount
                </Label>
                <Select
                  value={config.box_led_mount ?? "both"}
                  onValueChange={(v) => update("box_led_mount", v)}
                  disabled={disabled}
                >
                  <SelectTrigger
                    data-testid="box-led-mount-select"
                    className="rounded-none bg-zinc-950 border-zinc-800 font-mono text-xs h-9"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-none bg-zinc-950 border-zinc-800">
                    <SelectItem value="puck" className="font-mono text-xs rounded-none">
                      Puck LED only
                    </SelectItem>
                    <SelectItem value="strip" className="font-mono text-xs rounded-none">
                      Strip / string LED
                    </SelectItem>
                    <SelectItem value="both" className="font-mono text-xs rounded-none">
                      Both (puck + strip)
                    </SelectItem>
                    <SelectItem value="none" className="font-mono text-xs rounded-none">
                      None (empty cavity)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {(config.box_led_mount === "puck" || config.box_led_mount === "both") && (
                <Row
                  label="Puck Ø"
                  value={config.box_puck_diameter_mm ?? 65}
                  unit="mm"
                  testid="row-box-puck"
                  hint="Common LED puck sizes: 50, 65, 80 mm."
                >
                  <Slider
                    data-testid="box-puck-slider"
                    value={[config.box_puck_diameter_mm ?? 65]}
                    onValueChange={([v]) => update("box_puck_diameter_mm", v)}
                    min={30}
                    max={120}
                    step={5}
                    disabled={disabled}
                  />
                </Row>
              )}

              <div className="flex items-center justify-between pt-1">
                <Label
                  htmlFor="box-diffuser-toggle"
                  className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500"
                >
                  Frosted diffuser
                </Label>
                <button
                  type="button"
                  id="box-diffuser-toggle"
                  data-testid="box-diffuser-toggle"
                  onClick={() => update("box_diffuser", !(config.box_diffuser ?? true))}
                  disabled={disabled}
                  className={`px-3 h-7 border font-mono text-[10px] uppercase tracking-[0.15em] transition-colors ${
                    (config.box_diffuser ?? true)
                      ? "border-amber-500/60 bg-amber-500/20 text-amber-100"
                      : "border-zinc-700 text-zinc-500"
                  }`}
                >
                  {(config.box_diffuser ?? true) ? "On" : "Off"}
                </button>
              </div>
              <div className="font-mono text-[9px] text-zinc-600 leading-tight">
                Cable-exit notch · always-on · 6 mm at bottom-rear edge of the back panel
              </div>
            </div>
          )}

          <Row
            label={isRoundLitho ? "Lithophane Ø" : "Width"}
            value={isRoundLitho ? Math.min(config.width_mm, config.height_mm) : config.width_mm}
            unit="mm"
            testid="row-width"
          >
            <Slider
              data-testid="width-slider"
              value={[isRoundLitho ? Math.min(config.width_mm, config.height_mm) : config.width_mm]}
              onValueChange={([v]) => {
                if (isRoundLitho) {
                  setConfig((c) => ({ ...c, width_mm: v, height_mm: v }));
                } else {
                  update("width_mm", v);
                }
              }}
              min={40}
              max={300}
              step={1}
              disabled={disabled}
            />
          </Row>

          {!isRoundLitho && (
            <Row
              label="Height"
              value={config.height_mm}
              unit="mm"
              testid="row-height"
            >
              <Slider
                data-testid="height-slider"
                value={[config.height_mm]}
                onValueChange={([v]) => update("height_mm", v)}
                min={40}
                max={300}
                step={1}
                disabled={disabled}
              />
            </Row>
          )}

          <Row
            label="Thickness"
            value={config.thickness_mm.toFixed(2)}
            unit="mm"
            testid="row-thickness"
            hint={
              config.thickness_mm > 2.6
                ? "Above 2.5 mm absorbs most back-light"
                : config.thickness_mm < 1.8
                  ? "Below 1.8 mm loses color depth"
                  : "Recommended 2.0–2.5 mm for color lithophanes"
            }
          >
            <Slider
              data-testid="thickness-slider"
              value={[config.thickness_mm]}
              onValueChange={([v]) => update("thickness_mm", v)}
              min={1.5}
              max={4}
              step={0.05}
              disabled={disabled}
            />
          </Row>

          <Row
            label="Border"
            value={config.border_mm.toFixed(1)}
            unit="mm"
            testid="row-border"
          >
            <Slider
              data-testid="border-slider"
              value={[config.border_mm]}
              onValueChange={([v]) => update("border_mm", v)}
              min={0}
              max={10}
              step={0.5}
              disabled={disabled}
            />
          </Row>

          <Row
            label="Base fill"
            value={config.base_min_layers ?? 2}
            unit="layer"
            testid="row-base-min-layers"
          >
            <Slider
              data-testid="base-min-layers-slider"
              value={[config.base_min_layers ?? 2]}
              onValueChange={([v]) => update("base_min_layers", Math.round(v))}
              min={1}
              max={5}
              step={1}
              disabled={disabled}
            />
          </Row>

          {(config.geometry === "curved" || config.geometry === "cylindrical") && (
            <Row
              label="Curve radius"
              value={config.curve_radius_mm}
              unit="mm"
              testid="row-curve"
            >
              <Slider
                data-testid="curve-slider"
                value={[config.curve_radius_mm]}
                onValueChange={([v]) => update("curve_radius_mm", v)}
                min={20}
                max={200}
                step={1}
                disabled={disabled}
              />
            </Row>
          )}

          {isDisc && (
            <Row
              label="Dome height"
              value={config.dome_mm.toFixed(1)}
              unit="mm"
              testid="row-dome"
            >
              <Slider
                data-testid="dome-slider"
                value={[config.dome_mm]}
                onValueChange={([v]) => update("dome_mm", v)}
                min={0}
                max={8}
                step={0.1}
                disabled={disabled}
              />
              <div className="font-mono text-[10px] text-zinc-600 mt-1">
                0 mm = flat disc · &gt;0 adds a gentle dome to the top face
              </div>
            </Row>
          )}
        </div>
      </div>

      <div className="border-t border-zinc-800" />

      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500 mb-3 flex items-center gap-1.5">
          Print limits
          <HelpHint title="Layer height & swaps" testId="help-print-limits">
            <strong className="text-zinc-200">Layer height</strong>:
            thinner layers = better color resolution & smoother gradients
            but much longer print time.
            <br /><br />
            <strong className="text-zinc-200">Max color swaps</strong>:
            how many times the printer changes filament during the print.
            Every swap adds purge waste; lower = faster prints but
            coarser color. Most printers cap at 8 swaps before purge
            tower height becomes a problem.
            <br /><br />
            <strong className="text-zinc-200">Relief</strong> (Painting
            mode): 0 = flat plateaus, 100 = full luminance bas-relief.
          </HelpHint>
        </div>
        <div className="space-y-4">
          <div>
            <Label className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 mb-2 block">
              Layer height
            </Label>
            <Select
              value={String(config.layer_height_mm)}
              onValueChange={(v) => update("layer_height_mm", parseFloat(v))}
              disabled={disabled}
            >
              <SelectTrigger
                data-testid="layer-height-select"
                className="rounded-none bg-zinc-950 border-zinc-800 font-mono text-xs h-9"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-none bg-zinc-950 border-zinc-800">
                {layerOptions.map((h) => (
                  <SelectItem
                    key={h}
                    value={String(h)}
                    className="font-mono text-xs rounded-none"
                  >
                    {h.toFixed(2)} mm ({lhLabel(h)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div
              className="font-mono text-[9px] text-zinc-600 mt-1"
              data-testid="layer-height-range-hint"
            >
              {nozzle.toFixed(2)} mm nozzle → {lhMin.toFixed(2)}–{lhMax.toFixed(2)} mm
              layer window (25–80% of Ø).
            </div>
          </div>

          <Row
            label="Max color swaps"
            value={`${config.max_swaps} / ${swapsMax}`}
            unit=""
            testid="row-swaps"
          >
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label="Decrease swaps"
                data-testid="swaps-slider-dec"
                onClick={() => handleSwapsChange(Math.max(1, config.max_swaps - 1))}
                disabled={disabled || config.max_swaps <= 1}
                className="w-6 h-6 flex-shrink-0 flex items-center justify-center border border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-600 active:bg-zinc-800 disabled:opacity-30 transition-colors duration-150 touch-manipulation font-mono text-sm leading-none"
              >
                −
              </button>
              <Slider
                data-testid="swaps-slider"
                value={[config.max_swaps]}
                onValueChange={([v]) => handleSwapsChange(v)}
                min={1}
                max={swapsMax}
                step={1}
                disabled={disabled}
                className="flex-1"
              />
              <button
                type="button"
                aria-label="Increase swaps"
                data-testid="swaps-slider-inc"
                onClick={() => handleSwapsChange(Math.min(swapsMax, config.max_swaps + 1))}
                disabled={disabled || config.max_swaps >= swapsMax}
                className="w-6 h-6 flex-shrink-0 flex items-center justify-center border border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-600 active:bg-zinc-800 disabled:opacity-30 transition-colors duration-150 touch-manipulation font-mono text-sm leading-none"
              >
                +
              </button>
            </div>
            <div className="font-mono text-[10px] text-zinc-600 mt-1">
              uses {config.max_swaps + 1} filaments · {config.max_swaps} swap
              {config.max_swaps === 1 ? "" : "s"}
            </div>
          </Row>

          {isPainting && (
            <Row
              label="Relief"
              value={`${Math.round(config.relief * 100)}%`}
              unit=""
              testid="row-relief"
            >
              <Slider
                data-testid="relief-slider"
                value={[config.relief]}
                onValueChange={([v]) => update("relief", v)}
                min={0}
                max={1}
                step={0.05}
                disabled={disabled}
              />
              <div className="font-mono text-[10px] text-zinc-600 mt-1">
                0% = flat plateaus · 100% = luminance-driven bas-relief
              </div>
            </Row>
          )}

          {isPainting && (
            <Row
              label="Smoothing"
              value={`${Math.round((config.smoothing ?? 0) * 100)}%`}
              unit=""
              testid="row-smoothing"
            >
              <Slider
                data-testid="smoothing-slider"
                value={[config.smoothing ?? 0]}
                onValueChange={([v]) => update("smoothing", v)}
                min={0}
                max={1}
                step={0.05}
                disabled={disabled}
              />
              <div className="font-mono text-[10px] text-zinc-600 mt-1">
                Median pre-pass — reduces speckled boundaries on photos.
              </div>
            </Row>
          )}

          {isPainting && (
            <Row
              label="Frame"
              value={(config.frame_mm ?? 0).toFixed(1)}
              unit="mm"
              testid="row-frame"
            >
              <Slider
                data-testid="frame-slider"
                value={[config.frame_mm ?? 0]}
                onValueChange={([v]) => update("frame_mm", v)}
                min={0}
                max={15}
                step={0.5}
                disabled={disabled}
              />
              <div className="font-mono text-[10px] text-zinc-600 mt-1">
                Matboard bezel painted in the brightest filament · 0 = off.
              </div>
            </Row>
          )}

          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="panel-muted p-3">
              <div className="text-[9px] uppercase tracking-[0.15em] text-zinc-500">
                Total layers
              </div>
              <div className="font-mono text-lg text-zinc-100 tabular-nums mt-1">
                {Math.max(1, Math.round(config.thickness_mm / config.layer_height_mm))}
              </div>
            </div>
            <div className="panel-muted p-3">
              <div className="text-[9px] uppercase tracking-[0.15em] text-zinc-500">
                Volume
              </div>
              <div className="font-mono text-lg text-zinc-100 tabular-nums mt-1">
                {isRoundLitho
                  ? (Math.PI * Math.pow(Math.min(config.width_mm, config.height_mm) / 2, 2) * config.thickness_mm / 1000).toFixed(1)
                  : ((config.width_mm * config.height_mm * config.thickness_mm) / 1000).toFixed(1)}
                <span className="text-zinc-600 text-xs ml-1">cm³</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
