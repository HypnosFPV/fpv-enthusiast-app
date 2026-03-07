// src/components/ImageZoomModal.tsx
import React, { useCallback } from 'react';
import {
  Modal,
  View,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  StatusBar,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import {
  GestureHandlerRootView,
  GestureDetector,
  Gesture,
} from 'react-native-gesture-handler';

const { width: W, height: H } = Dimensions.get('window');
const MIN_SCALE = 1;
const MAX_SCALE = 5;

interface ImageZoomModalProps {
  visible: boolean;
  uri: string | null;
  onClose: () => void;
}

export default function ImageZoomModal({
  visible,
  uri,
  onClose,
}: ImageZoomModalProps): React.JSX.Element | null {
  const scale      = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const transX     = useSharedValue(0);
  const transY     = useSharedValue(0);
  const savedX     = useSharedValue(0);
  const savedY     = useSharedValue(0);

  const reset = useCallback((): void => {
    'worklet';
    scale.value      = withSpring(1);
    savedScale.value = 1;
    transX.value     = withSpring(0);
    transY.value     = withSpring(0);
    savedX.value     = 0;
    savedY.value     = 0;
  }, [scale, savedScale, transX, transY, savedX, savedY]);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      const next = savedScale.value * e.scale;
      scale.value = Math.min(Math.max(next, MIN_SCALE), MAX_SCALE);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value < MIN_SCALE) {
        scale.value      = withSpring(MIN_SCALE);
        savedScale.value = MIN_SCALE;
      }
    });

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      if (scale.value > 1) {
        transX.value = savedX.value + e.translationX;
        transY.value = savedY.value + e.translationY;
      }
    })
    .onEnd(() => {
      savedX.value = transX.value;
      savedY.value = transY.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) {
        scale.value      = withSpring(1);
        savedScale.value = 1;
        transX.value     = withSpring(0);
        transY.value     = withSpring(0);
        savedX.value     = 0;
        savedY.value     = 0;
      } else {
        scale.value      = withSpring(2.5);
        savedScale.value = 2.5;
      }
    });

  const composed = Gesture.Simultaneous(pinch, pan, doubleTap);

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: transX.value },
      { translateY: transY.value },
      { scale: scale.value },
    ],
  }));

  if (!visible || !uri) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onShow={() => {
        scale.value      = 1;
        savedScale.value = 1;
        transX.value     = 0;
        transY.value     = 0;
        savedX.value     = 0;
        savedY.value     = 0;
      }}
      onRequestClose={onClose}
    >
      {Platform.OS === 'android' && <StatusBar hidden />}
      <GestureHandlerRootView style={styles.overlay}>
        <View style={styles.header} pointerEvents="box-none">
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeBtn}
            hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
          >
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
        </View>

        <GestureDetector gesture={composed}>
          <Animated.Image
            source={{ uri }}
            style={[styles.image, animStyle]}
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
    backgroundColor: 'rgba(0,0,0,0.96)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 52 : 16,
    right: 16,
    zIndex: 20,
  },
  closeBtn: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 20,
    padding: 6,
  },
  image: {
    width: W,
    height: H,
  },
});
