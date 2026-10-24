import React, { createContext, useContext, useMemo } from "react";
import {
  Platform,
  StatusBar,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export interface StageSize {
  width: number;
  height: number;
}

export interface StageInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface StageMetrics extends StageSize {
  insets: StageInsets;
}

const StageContext = createContext<StageMetrics | null>(null);

function useStageMetrics(): StageMetrics {
  const window = useWindowDimensions();
  const fallback = useContext(StageContext);
  return (
    fallback ?? {
      width: window.width,
      height: window.height,
      insets: { top: 0, right: 0, bottom: 0, left: 0 },
    }
  );
}

/**
 * Size of the playfield box, which stops matching the window once the stage is
 * turned. Anything drawing in absolute screen coordinates needs this instead of
 * `useWindowDimensions`.
 */
export function useStageSize(): StageSize {
  const { width, height } = useStageMetrics();
  return { width, height };
}

/**
 * Safe-area insets in stage coordinates. The stage deliberately applies no
 * padding of its own, so whatever needs to clear the system bars reads these
 * and pads itself; absolutely positioned children could not rely on inherited
 * padding anyway.
 */
export function useStageInsets(): StageInsets {
  return useStageMetrics().insets;
}

/** Flow content inset clear of the system bars, in stage coordinates. */
export function StageSafeArea({ children }: { children: React.ReactNode }) {
  const insets = useStageInsets();
  return (
    <View
      style={[
        styles.fill,
        {
          paddingTop: insets.top,
          paddingRight: insets.right,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
        },
      ]}
    >
      {children}
    </View>
  );
}

interface RotatedStageProps {
  landscape: boolean;
  backgroundColor: string;
  children: React.ReactNode;
}

/**
 * Turns the whole screen a quarter turn in JS rather than asking the OS.
 *
 * Device auto-rotate is often switched off system-wide, and the manifest
 * orientation is fixed at build time, so neither can be relied on. Rotating a
 * sized box here works on any installed build and ships over the air.
 */
export function RotatedStage({
  landscape,
  backgroundColor,
  children,
}: RotatedStageProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const metrics = useMemo<StageMetrics>(() => {
    // Android reports a zero top inset in some edge-to-edge configurations, and
    // the clock then sits on top of the HUD, so take whichever is larger.
    const top = Math.max(
      insets.top,
      Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0,
    );

    if (!landscape) {
      return {
        width,
        height,
        insets: {
          top,
          right: insets.right,
          bottom: insets.bottom,
          left: insets.left,
        },
      };
    }

    // A clockwise quarter turn sends the device's right edge to the top of the
    // stage, so the insets travel round with it.
    return {
      width: height,
      height: width,
      insets: {
        top: insets.right,
        right: insets.bottom,
        bottom: insets.left,
        left: top,
      },
    };
  }, [
    landscape,
    width,
    height,
    insets.top,
    insets.right,
    insets.bottom,
    insets.left,
  ]);

  if (!landscape) {
    return (
      <StageContext.Provider value={metrics}>
        <View style={[styles.fill, { backgroundColor }]}>{children}</View>
      </StageContext.Provider>
    );
  }

  return (
    <StageContext.Provider value={metrics}>
      <View style={[styles.fill, { backgroundColor }]}>
        <View
          style={[
            styles.rotated,
            {
              width: metrics.width,
              height: metrics.height,
              left: (width - metrics.width) / 2,
              top: (height - metrics.height) / 2,
            },
          ]}
        >
          {children}
        </View>
      </View>
    </StageContext.Provider>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  rotated: {
    position: "absolute",
    transform: [{ rotate: "90deg" }],
  },
});
