/** Barrel re-exports — split modules keep each file under ~400 LOC. */
export {
  type AmbientEffectMode,
  premiumAmbientIntervalMs,
  setActiveAppearancePreferences,
  getActiveAppearancePreferences,
  advanceAppearanceAnimationClock,
  appearanceAnimationNow,
  setAppearanceRenderQuality,
  getAppearanceRenderQuality,
  setAppearanceRenderHealth,
  getAppearanceRenderHealth,
  resolveAmbientEffectMode,
  resolveQualityAdjustedAmbientEffectMode,
  appearanceAnimationFrameIntervalMs,
  ambientAnimationActive,
  ambientAnimationRenderTick,
  motionEffectsAllowed,
  shouldRenderAmbientEffects,
  motionProgress,
} from '#/tui/utils/appearance-state';

export {
  PREMIUM_PARTICLES,
  BRAND_MOTION_TOKENS,
  PARTICLE_TOKENS,
  renderParticleRail,
  renderParticleDivider,
  renderMeteorField,
  renderAmbientDrift,
} from '#/tui/utils/appearance-particles';

export {
  SPECTACULAR_TOKENS,
  type SpectacularTextOptions,
  renderAnimatedGradientText,
  renderSpectacularText,
  renderPremiumHeadline,
  renderPremiumAccentLine,
} from '#/tui/utils/appearance-gradient';

export { renderPulseText, renderPulseGlyph } from '#/tui/utils/appearance-pulse';

export { renderShimmerPrefix } from '#/tui/utils/appearance-shimmer';

export {
  type MotionToolPhase,
  SETTLE_FLASH_MS,
  CROSSFADE_MS,
  ENTER_BEAT_MS,
  EXIT_BEAT_MS,
  TYPEWRITER_MS,
  TYPEWRITER_CURSOR,
  enterBeatDurationMs,
  exitBeatDurationMs,
  renderSettleFlash,
  isToneSettleFlashActive,
  renderToneSettleFlash,
  STATUS_FLASH_MS,
  statusFlashDurationMs,
  isStatusFlashActive,
  renderStatusFlashLine,
  renderPhaseChip,
  renderCrossfadeLine,
  renderTypewriterLine,
  renderEnterBeat,
  renderExitBeat,
  renderDangerBreathe,
} from '#/tui/utils/appearance-motion';

export {
  resolveUltraworkBorderGlowHex,
  resolveUltraworkEditorBorderStyle,
  paintUltraworkEditorBorderGlow,
} from '#/tui/utils/appearance-ultrawork';

export {
  type PremiumBoxFrameOptions,
  renderPremiumBoxFrame,
} from '#/tui/utils/appearance-box-frame';
