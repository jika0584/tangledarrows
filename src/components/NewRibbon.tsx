import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface NewRibbonProps {
  /** Tile edge length — ribbon scales with it. */
  size: number;
}

/**
 * Tiny corner “NEW” ribbon (reference badge), clipped to the tile’s top-right.
 */
export function NewRibbon({ size }: NewRibbonProps) {
  const band = Math.max(10, Math.round(size * 0.28));
  const fontSize = Math.max(7, Math.round(size * 0.14));

  return (
    <View pointerEvents="none" style={styles.clip}>
      <View
        style={[
          styles.band,
          {
            width: size * 0.85,
            height: band,
            top: band * 0.35,
            right: -size * 0.22,
          },
        ]}
      >
        <Text style={[styles.label, { fontSize }]}>NEW</Text>
      </View>
      <View style={[styles.foldTop, { borderTopWidth: band * 0.22, borderRightWidth: band * 0.22 }]} />
      <View style={[styles.foldRight, { borderLeftWidth: band * 0.22, borderBottomWidth: band * 0.22 }]} />
    </View>
  );
}

const RIBBON = '#3B82F6';
const FOLD = '#1D4ED8';

const styles = StyleSheet.create({
  clip: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
    borderRadius: 12,
  },
  band: {
    position: 'absolute',
    backgroundColor: RIBBON,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '45deg' }],
    zIndex: 2,
  },
  label: {
    color: '#FFFFFF',
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  foldTop: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 0,
    height: 0,
    borderTopColor: FOLD,
    borderRightColor: 'transparent',
    zIndex: 1,
  },
  foldRight: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 0,
    height: 0,
    borderLeftColor: 'transparent',
    borderBottomColor: FOLD,
    zIndex: 1,
  },
});
