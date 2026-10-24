import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { ArrowDefinition, CELL_FLOOR, Level } from '../levels/types';
import { useColors } from '../theme/theme';

interface LevelThumbnailProps {
  level: Level;
  size: number;
}

/** Lightweight silhouette + arrow strokes for the stage preview modal. */
export function LevelThumbnail({ level, size }: LevelThumbnailProps) {
  const colors = useColors();
  const { rows, cols, matrix } = level.grid;
  const cell = Math.max(2, Math.floor(size / Math.max(rows, cols)));
  const width = cols * cell;
  const height = rows * cell;
  const padX = (size - width) / 2;
  const padY = (size - height) / 2;

  const floors = useMemo(() => {
    const cells: { key: string; left: number; top: number }[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (matrix[r]?.[c] === CELL_FLOOR) {
          cells.push({ key: `${r},${c}`, left: padX + c * cell, top: padY + r * cell });
        }
      }
    }
    return cells;
  }, [matrix, rows, cols, cell, padX, padY]);

  return (
    <View style={[styles.frame, { width: size, height: size, backgroundColor: colors.boardShape }]}>
      {floors.map((floor) => (
        <View
          key={floor.key}
          style={{
            position: 'absolute',
            left: floor.left,
            top: floor.top,
            width: cell,
            height: cell,
            backgroundColor: colors.surface,
          }}
        />
      ))}
      {level.arrows.map((arrow) => (
        <ArrowStroke key={arrow.id} arrow={arrow} cell={cell} padX={padX} padY={padY} color={colors.arrow} />
      ))}
    </View>
  );
}

function ArrowStroke({
  arrow,
  cell,
  padX,
  padY,
  color,
}: {
  arrow: ArrowDefinition;
  cell: number;
  padX: number;
  padY: number;
  color: string;
}) {
  const stroke = Math.max(1.5, cell * 0.35);
  const segments = [];
  for (let i = 0; i < arrow.cells.length; i++) {
    const { row, col } = arrow.cells[i];
    segments.push(
      <View
        key={`${arrow.id}-${i}`}
        style={{
          position: 'absolute',
          left: padX + col * cell + (cell - stroke) / 2,
          top: padY + row * cell + (cell - stroke) / 2,
          width: stroke,
          height: stroke,
          borderRadius: stroke / 2,
          backgroundColor: color,
        }}
      />,
    );
  }
  return <>{segments}</>;
}

const styles = StyleSheet.create({
  frame: {
    borderRadius: 20,
    overflow: 'hidden',
  },
});
