The code for our IROS 2020 paper is now public at [github.com/irtiq7/iROS2020](https://github.com/irtiq7/iROS2020). The repository contains MATLAB code to replicate the experiments in the paper.

> U. Saqib and J. R. Jensen, "A model-based approach to acoustic reflector localization with a robotic platform," *IEEE/RSJ International Conference on Intelligent Robots and Systems (IROS)*, Las Vegas, NV, USA, 2020, pp. 4499–4504. [Read the paper](https://ieeexplore.ieee.org/document/9341437).

## The problem

Building a spatial map of an indoor environment, such as an office with glass walls, is difficult for camera- and laser-based methods, because they struggle to detect transparent surfaces. The maps they produce are therefore often inaccurate.

## The approach

We use echolocation with sound in the audible frequency range. The robot emits sound from a loudspeaker and records the echoes with a single microphone. A model-based method then estimates the position of the acoustic reflector, such as a wall or a glass surface. Repeating this as the robot moves builds up a spatial map of the environment.

A single microphone and a loudspeaker are already present on many socially assistive robots, such as NAO, so the method needs no special sensors. In our experiments it detected a reflector up to 1.5 m away in more than 60% of the trials, and it kept working at low signal-to-noise ratios.

## The robot platform

To test the method, we built a proof-of-concept robotic platform that constructs a spatial map of an indoor environment.

![The proof-of-concept robot: a loudspeaker and microphone mounted on a mobile base](images/posts/iros2020-robot-platform.webp)
*The proof-of-concept robotic platform.*

It combines:

- a Kobuki mobile base
- a UDOO x86 microcomputer
- a PreSonus 1818 audio interface
- a Dynaudio loudspeaker
- a G.R.A.S. measurement microphone
- a TFMini micro lidar

![Diagram of the hardware: loudspeaker and microphone connected to the audio interface, which connects to the UDOO x86 on the Kobuki base, together with a TFMini lidar](images/posts/iros2020-hardware.webp)
*The hardware needed to build a similar platform, and how the parts connect.*
