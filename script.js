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
    const textDisplay = document.getElementById("text-display");

    playPauseBtn.addEventListener("click", function() {
        const audio = audioElements[currentAudioIndex];
        if (audio.paused) {
            audio.play();
            playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
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
