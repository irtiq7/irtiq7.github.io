document.addEventListener("DOMContentLoaded", function() {
    // Set the current date
    const currentDateElement = document.getElementById("currentDate");
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const currentDate = new Date().toLocaleDateString(undefined, options);
    currentDateElement.textContent = currentDate;

    const audioContainer = document.getElementById("audio-container");
    const playPauseBtn = document.getElementById("playPauseBtn");
    const seekBar = document.getElementById("seekBar");
    const currentTimeElem = document.getElementById("currentTime");
    const totalTimeElem = document.getElementById("totalTime");
    const audioFileNameElement = document.getElementById("audioFileName");
    let audioElements = [];
    let currentAudioIndex = 0;

    // Function to load all .wav files dynamically from the daily_news folder
    function loadAudioFiles() {
        fetch('daily_news/')
            .then(response => response.text())
            .then(data => {
                const parser = new DOMParser();
                const doc = parser.parseFromString(data, 'text/html');
                const audioFiles = Array.from(doc.querySelectorAll('a'))
                    .map(link => link.href)
                    .filter(href => href.endsWith('.wav'));

                audioFiles.forEach((file, index) => {
                    const audio = document.createElement("audio");
                    audio.id = `audio${index}`;
                    audio.src = `daily_news/${file}`;
                    audioContainer.appendChild(audio);
                    audioElements.push(audio);
                });

                // Initialize the first audio element
                if (audioElements.length > 0) {
                    updateAudioFileName();
                    updateSeekBar();
                } else {
                    console.error("No audio files found in the daily_news folder.");
                }
            })
            .catch(error => {
                console.error("Error loading audio files:", error);
            });
    }

    loadAudioFiles();

    function playNextAudio() {
        if (currentAudioIndex < audioElements.length - 1) {
            currentAudioIndex++;
            audioElements[currentAudioIndex].play();
            updateSeekBar();
            updateAudioFileName();
            changeBackgroundImage();
        }
    }

    function updateSeekBar() {
        const audio = audioElements[currentAudioIndex];
        audio.addEventListener("timeupdate", function() {
            const currentTime = audio.currentTime;
            const duration = audio.duration;
            const progress = (currentTime / duration) * 100;
            seekBar.value = progress;
            currentTimeElem.textContent = formatTime(currentTime);
            totalTimeElem.textContent = formatTime(duration);
        });

        audio.addEventListener("ended", playNextAudio);
    }

    function updateAudioFileName() {
        const audio = audioElements[currentAudioIndex];
        audioFileNameElement.textContent = `Playing: ${audio.src.split('/').pop()}`;
    }

    function changeBackgroundImage() {
        const images = ['url(image1.jpg)', 'url(image2.jpg)']; // Add your background images here
        document.body.style.backgroundImage = images[currentAudioIndex % images.length];
    }

    playPauseBtn.addEventListener("click", function() {
        const audio = audioElements[currentAudioIndex];
        if (audio.paused) {
            audio.play();
            playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
            updateSeekBar();
            updateAudioFileName();
            changeBackgroundImage();
            startBackgroundChange();
        } else {
            audio.pause();
            playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
            stopBackgroundChange();
        }
    });

    seekBar.addEventListener("input", function() {
        const audio = audioElements[currentAudioIndex];
        const duration = audio.duration;
        const seekTime = (seekBar.value / 100) * duration;
        audio.currentTime = seekTime;
    });

    audioElements.forEach(audio => {
        audio.addEventListener("loadedmetadata", function() {
            totalTimeElem.textContent = formatTime(audio.duration);
        });
    });

    function formatTime(seconds) {
        const minutes = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
    }

    fetch('news.txt')
        .then(response => response.text())
        .then(data => {
            const textLines = data.split('\n');
            audioElements[0].addEventListener("play", function() {
                let lineIndex = 0;
                const interval = setInterval(() => {
                    if (audioElements[0].paused || audioElements[0].ended) {
                        clearInterval(interval);
                    } else if (lineIndex < textLines.length) {
                        textDisplay.textContent += textLines[lineIndex] + '\n';
                        textDisplay.scrollTop = textDisplay.scrollHeight;  // Scroll to the bottom
                        lineIndex++;
                    }
                }, 2000);  // Change text every 2 seconds
            });
        });

    const colors = ['#ffb6c1', '#f0f8ff', '#ffe4b5', '#98fb98', '#add8e6', '#ffb6c1', '#f0e68c', '#dda0dd', '#ff6347', '#4682b4'];
    let backgroundChangeInterval;

    function startBackgroundChange() {
        let colorIndex = 0;
        backgroundChangeInterval = setInterval(() => {
            document.body.style.backgroundColor = colors[colorIndex % colors.length];
            colorIndex++;
        }, 10000);  // Change background color every 10 seconds
    }

    function stopBackgroundChange() {
        clearInterval(backgroundChangeInterval);
    }

    // Add event listener for the tweet button
    document.getElementById('tweet-link').addEventListener('click', function() {
        const audioSrc = audioElements[currentAudioIndex].src;
        const tweetText = `Check out this audio news: ${audioSrc}`;
        const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;
        window.open(tweetUrl, '_blank');
    });
});
