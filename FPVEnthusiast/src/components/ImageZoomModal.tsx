// src/components/ImageZoomModal.tsx
import React from 'react';
import {
  Modal,
  View,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Dimensions,
  SafeAreaView,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  clamp,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const MAX_SCALE = 5;
const MIN_SCALE = 1;

interface Props {
  visible: boolean;
  uri: string | null;
  onClose: () => void;
}

export default function ImageZoomModal({ visible, uri, onClose }: Props) {
  const scale       = useSharedValue(1);
  const savedScale  = useSharedValue(1);
  const offsetX     = useSharedValue(0);
  const offsetY     = useSharedValue(0);
  const savedX      = useSharedValue(0);
  const savedY      = useSharedValue(0);

  // Reset on open
  const resetTransform = () => {
    scale.value   = withSpring(1);
    offsetX.value = withSpring(0);
    offsetY.value = withSpring(0);
    savedScale.value = 1;
    savedX.value = 0;
    savedY.value = 0;
  };

  // Pinch gesture
  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = clamp(savedScale.value * e.scale, MIN_SCALE, MAX_SCALE);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value < MIN_SCALE) {
        scale.value = withSpring(MIN_SCALE);
        savedScale.value = MIN_SCALE;
      }
    });

  // Pan gesture (only when zoomed in)
  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (scale.value > 1) {
        offsetX.value = savedX.value + e.translationX;
        offsetY.value = savedY.value + e.translationY;
      }
    })
    .onEnd(() => {
      savedX.value = offsetX.value;
      savedY.value = offsetY.value;
    });

  // Double-tap to toggle zoom
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) {
        scale.value      = withSpring(1);
        offsetX.value    = withSpring(0);
        offsetY.value    = withSpring(0);
        savedScale.value = 1;
        savedX.value     = 0;
        savedY.value     = 0;
      } else {
        scale.value      = withSpring(2.5);
        savedScale.value = 2.5;
      }
    });

  const composed = Gesture.Simultaneous(pinchGesture, panGesture, doubleTap);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: offsetX.value },
      { translateY: offsetY.value },
      { scale: scale.value },
    ],
  }));

  if (!uri) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onShow={resetTransform}
      onRequestClose={onClose}
    >
      <StatusBar hidden />
      <GestureHandlerRootView style={styles.overlay}>
        {/* Close button */}
        <SafeAreaView style={styles.header} pointerEvents="box-none">
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
        </SafeAreaView>

        {/* Zoomable image */}
        <GestureDetector gesture={composed}>
          <Animated.Image
            source={{ uri }}
            style={[styles.image, animatedStyle]}
            resizeMode="contain"
          />
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    position: 'absolute',
    top: 0,
    right: 0,
    left: 0,
    zIndex: 10,
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  closeBtn: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
    padding: 6,
  },
  image: {
    width: SCREEN_W,
    height: SCREEN_H,
  },
});
