/**
 * Moments — the reward moments over the Practice screen, one at a time: Playful's stars, the streak, the week's goal,
 * a run in tune, a unit or grade finished and Doh cheering (chosen by `lib/practiceMoments`, drawn by `lib/momentArt`,
 * the mirrors of the web's). Each frame is drawn through `lib/svgCanvas` and shown with react-native-svg at about 30
 * frames a second, so it needs no native module and ships over the air. Doh is the Practice art's own pose (`Art`).
 *
 * Never touchable and hidden from screen readers (the toast and the marks say what was earned). Nothing at all when
 * the system asks for reduced motion. `onPlaying` tells the screen which piece is up, so its own Doh can step aside.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, StyleSheet, View, useWindowDimensions } from "react-native";
import Svg, { ClipPath, Defs, G, LinearGradient, Path, RadialGradient, Stop, Text as SvgText } from "react-native-svg";

import { fonts } from "../../design/theme";
import { MOMENT_ART } from "../../lib/momentArt";
import type { Moment, MomentPiece } from "../../lib/practiceMoments";
import { svgCanvas, type ImageLayer, type Layer, type Matrix, type SvgLayer } from "../../lib/svgCanvas";
import { Art } from "./Art";
import type { ArtName } from "./art/svgs";

const FRAME_MS = 33;
const OUT_MS = 260;

/** A batch of moments to play, a new object each time a take earns some. */
export interface MomentBatch {
  id: number;
  moments: Moment[];
}

function matrix(m: Matrix): string {
  return `matrix(${m.map((n) => Math.round(n * 1000) / 1000).join(" ")})`;
}

/** rgba(r,g,b,a) as a colour and its opacity, for a gradient stop. */
function stop(color: string): { color: string; opacity: number } {
  const m = /rgba\(([\d.]+),([\d.]+),([\d.]+),([\d.]+)\)/.exec(color);
  return m ? { color: `rgb(${m[1]},${m[2]},${m[3]})`, opacity: Number(m[4]) } : { color, opacity: 1 };
}

function SvgFrame({ layer, width, height, art }: { layer: SvgLayer; width: number; height: number; art: { width: number; height: number } }) {
  return (
    <Svg style={StyleSheet.absoluteFill} width={width} height={height} viewBox={`0 0 ${art.width} ${art.height}`}>
      <Defs>
        {layer.gradients.map((g) => {
          const stops = g.stops.map((s, i) => {
            const c = stop(s.color);
            return <Stop key={i} offset={s.offset} stopColor={c.color} stopOpacity={c.opacity} />;
          });
          return g.kind === "linear" ? (
            <LinearGradient key={g.id} id={g.id} gradientUnits="userSpaceOnUse" x1={g.coords[0]} y1={g.coords[1]} x2={g.coords[2]} y2={g.coords[3]} gradientTransform={matrix(g.matrix)}>
              {stops}
            </LinearGradient>
          ) : (
            <RadialGradient key={g.id} id={g.id} gradientUnits="userSpaceOnUse" cx={g.coords[0]} cy={g.coords[1]} fx={g.coords[0]} fy={g.coords[1]} r={g.coords[2]} gradientTransform={matrix(g.matrix)}>
              {stops}
            </RadialGradient>
          );
        })}
        {layer.clips.map((c) => (
          <ClipPath key={c.id} id={c.id}>
            <Path d={c.d} />
          </ClipPath>
        ))}
      </Defs>
      {layer.items.map((item, i) => {
        const clip = item.clip ? `url(#${item.clip})` : undefined;
        if (item.kind === "text") {
          return (
            <G key={i} clipPath={clip} opacity={item.opacity}>
              <G transform={matrix(item.matrix)}>
                <SvgText x={0} y={item.size * 0.35} fontSize={item.size} fontFamily={fonts.bold} fill={item.color} textAnchor="middle">
                  {item.text}
                </SvgText>
              </G>
            </G>
          );
        }
        return (
          <Path
            key={i}
            d={item.d}
            fill={item.fill ?? "none"}
            stroke={item.stroke}
            strokeWidth={item.strokeWidth}
            strokeLinecap={item.cap}
            strokeLinejoin={item.join}
            opacity={item.opacity}
            clipPath={clip}
          />
        );
      })}
    </Svg>
  );
}

/** A picture on the card: its rectangle through a translate-and-scale transform (Doh's squash and stretch). */
function ImageFrame({ layer, scale }: { layer: ImageLayer; scale: number }) {
  const [sx, , , sy, e, f] = layer.matrix;
  const w = layer.width * scale;
  const h = layer.height * scale;
  // RN scales a view about its centre: place the unscaled view so its centre lands on the transformed rectangle's.
  const cx = (sx * (layer.x + layer.width / 2) + e) * scale;
  const cy = (sy * (layer.y + layer.height / 2) + f) * scale;
  return (
    <View
      style={{ position: "absolute", left: cx - w / 2, top: cy - h / 2, width: w, height: h, opacity: layer.opacity, transform: [{ scaleX: sx }, { scaleY: sy }] }}
    >
      <Art name={layer.name as ArtName} width={w} height={h} />
    </View>
  );
}

function Playing({ moment, onDone }: { moment: Moment; onDone: () => void }) {
  const art = MOMENT_ART[moment.piece];
  const { width: screen } = useWindowDimensions();
  const width = Math.min(art.width, screen - 32);
  const height = (width * art.height) / art.width;
  const [t, setT] = useState(0);
  const show = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const start = Date.now();
    let frame = 0;
    let last = 0;
    let over = false;
    Animated.timing(show, { toValue: 1, duration: 280, useNativeDriver: true }).start();
    const step = () => {
      const now = Date.now();
      if (now - last >= FRAME_MS) {
        last = now;
        setT(Math.min((now - start) / 1000, art.ms / 1000));
      }
      if (now - start < art.ms) {
        frame = requestAnimationFrame(step);
      } else if (!over) {
        over = true;
        Animated.timing(show, { toValue: 0, duration: OUT_MS, useNativeDriver: true }).start(() => onDone());
      }
    };
    frame = requestAnimationFrame(step);
    // A screen in the background draws no frames: the moment still ends.
    const cap = setTimeout(() => { if (!over) { over = true; onDone(); } }, art.ms + 1500);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(cap);
    };
  }, [art, onDone, show]);

  const layers: Layer[] = useMemo(() => {
    const c = svgCanvas();
    try {
      art.draw(c, t, moment.values);
    } catch {
      return [];
    }
    return c.frame();
  }, [art, moment.values, t]);

  return (
    <Animated.View
      style={{
        width,
        height,
        opacity: show,
        transform: [{ scale: show.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] }) }],
      }}
    >
      {layers.map((l, i) =>
        l.kind === "svg" ? <SvgFrame key={i} layer={l} width={width} height={height} art={art} /> : <ImageFrame key={i} layer={l} scale={width / art.width} />,
      )}
    </Animated.View>
  );
}

/** Plays each batch's moments in turn; a new batch starts over. */
export function Moments({ batch, reduceMotion, onPlaying }: { batch: MomentBatch | null; reduceMotion: boolean; onPlaying?: (piece: MomentPiece | null) => void }) {
  const [at, setAt] = useState(0);
  useEffect(() => setAt(0), [batch]);
  const moment = !reduceMotion && batch ? batch.moments[at] ?? null : null;
  const piece = moment?.piece ?? null;
  useEffect(() => {
    onPlaying?.(piece);
  }, [piece, onPlaying]);
  const done = useMemo(() => () => setAt((i) => i + 1), []);
  if (!moment || !batch) return null;
  return (
    <View pointerEvents="none" style={styles.layer} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Playing key={`${batch.id}-${at}`} moment={moment} onDone={done} />
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: "absolute", left: 0, right: 0, top: "30%", alignItems: "center" },
});
