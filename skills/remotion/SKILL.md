---
name: remotion
description: Best practices for Remotion — programmatic video creation in React. Use when working with Remotion code, creating video compositions, adding animations, captions, audio, or rendering video.
---

# Remotion Best Practices

Use this skill when dealing with Remotion code for domain-specific knowledge on video creation in React.

## Key Concepts

- **Compositions** — Define video dimensions, duration, FPS, and default props
- **Sequences** — Time-based layout for layering and ordering content
- **Interpolation** — `interpolate()` and `spring()` for smooth animations
- **useCurrentFrame/useVideoConfig** — Core hooks for frame-based logic

## Topics

For detailed rules and code examples, load the relevant rule file from `rules/`:

- **Animations** (`rules/animations.md`) — Fundamental animation patterns, interpolation, spring physics
- **Text Animations** (`rules/text-animations.md`) — Typography and text animation patterns
- **Transitions** (`rules/transitions.md`) — Scene transition patterns
- **Timing** (`rules/timing.md`) — Interpolation curves: linear, easing, spring
- **Sequencing** (`rules/sequencing.md`) — Sequencing patterns for multi-scene videos
- **Compositions** (`rules/compositions.md`) — Defining compositions, stills, folders, default props
- **Assets** (`rules/assets.md`) — Importing images, videos, audio, and fonts
- **Videos** (`rules/videos.md`) — Embedding videos: trimming, volume, speed, looping, pitch
- **Audio** (`rules/audio.md`) — Using audio and sound
- **Audio Visualization** (`rules/audio-visualization.md`) — Spectrum bars, waveforms, bass-reactive effects
- **Captions/Subtitles** (`rules/subtitles.md`) — Caption handling and styling
- **Fonts** (`rules/fonts.md`) — Loading Google Fonts and local fonts
- **Images** (`rules/images.md`) — Embedding images with the Img component
- **GIFs** (`rules/gifs.md`) — Displaying GIFs synchronized with timeline
- **Charts** (`rules/charts.md`) — Chart and data visualization patterns
- **3D** (`rules/3d.md`) — 3D content using Three.js and React Three Fiber
- **Lottie** (`rules/lottie.md`) — Embedding Lottie animations
- **Light Leaks** (`rules/light-leaks.md`) — Light leak overlay effects
- **Maps** (`rules/maps.md`) — Add maps using Mapbox and animate them
- **Transparent Videos** (`rules/transparent-videos.md`) — Rendering with transparency
- **Trimming** (`rules/trimming.md`) — Trimming patterns
- **TailwindCSS** (`rules/tailwind.md`) — Using TailwindCSS in Remotion
- **Parameters** (`rules/parameters.md`) — Make videos parametrizable with Zod schemas
- **Calculate Metadata** (`rules/calculate-metadata.md`) — Dynamically set duration, dimensions, props
- **Measuring Text** (`rules/measuring-text.md`) — Text dimensions, fitting, overflow checking
- **Measuring DOM** (`rules/measuring-dom-nodes.md`) — Measuring DOM element dimensions
- **FFmpeg** (`rules/ffmpeg.md`) — Video operations: trimming, silence detection
- **Voiceover** (`rules/voiceover.md`) — AI-generated voiceover with ElevenLabs TTS
- **Sound Effects** (`rules/sound-effects.md`) — Using sound effects
- **Video Duration** (`rules/get-video-duration.md`) — Getting video duration with Mediabunny
- **Audio Duration** (`rules/get-audio-duration.md`) — Getting audio duration with Mediabunny
- **Video Dimensions** (`rules/get-video-dimensions.md`) — Getting video width/height with Mediabunny
- **Can Decode** (`rules/can-decode.md`) — Check browser decode support with Mediabunny
- **Extract Frames** (`rules/extract-frames.md`) — Extract frames at specific timestamps
