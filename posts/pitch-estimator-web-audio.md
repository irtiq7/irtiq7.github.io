This was my first project with the browser's Web Audio API: a small web page that listens to your microphone and estimates the pitch, or fundamental frequency, of the sound it hears, much like an instrument tuner.

**Try it:** [open the pitch estimator](pitch_estimator.html). Your browser will ask for permission to use the microphone.

## How it works

1. **Audio input.** [p5.js](https://p5js.org/) and its sound library open the microphone through the Web Audio API.
2. **Pitch estimation.** The microphone stream is passed to the pitch-detection model in [ml5.js](https://ml5js.org/), which runs CREPE, a convolutional neural network for monophonic pitch estimation, directly in the browser.
3. **Display.** The page shows the latest estimate in hertz and refreshes it ten times per second.

The model is downloaded once when the page loads; the audio itself is processed locally in the browser.

## Why pitch?

Pitch estimation is a classic problem in signal processing. The fundamental frequency describes much of what we hear in speech and music, and estimating it reliably in noise is still an active research topic. Running a learned estimator in real time on an ordinary laptop, with nothing more than a web page, is a nice way to see how far these methods have come.

## Reference

J. W. Kim, J. Salamon, P. Li and J. P. Bello, "CREPE: A Convolutional Representation for Pitch Estimation," *IEEE International Conference on Acoustics, Speech and Signal Processing (ICASSP)*, 2018. arXiv:1802.06182.
