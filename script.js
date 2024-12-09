document.addEventListener("DOMContentLoaded", function() {
    // Set the current date
    const currentDateElement = document.getElementById("currentDate");
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const currentDate = new Date().toLocaleDateString(undefined, options);
    currentDateElement.textContent = currentDate;

    const audio = document.getElementById("audio");
    const playPauseBtn = document.getElementById("playPauseBtn");
    const seekBar = document.getElementById("seekBar");
    const currentTimeElem = document.getElementById("currentTime");
    const totalTimeElem = document.getElementById("totalTime");
    const textDisplay = document.getElementById("text-display");

    playPauseBtn.addEventListener("click", function() {
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

    audio.addEventListener("timeupdate", function() {
        const currentTime = audio.currentTime;
        const duration = audio.duration;
        const progress = (currentTime / duration) * 100;
        seekBar.value = progress;
        currentTimeElem.textContent = formatTime(currentTime);
        totalTimeElem.textContent = formatTime(duration);
    });

    seekBar.addEventListener("input", function() {
        const duration = audio.duration;
        const seekTime = (seekBar.value / 100) * duration;
        audio.currentTime = seekTime;
    });

    audio.addEventListener("loadedmetadata", function() {
        totalTimeElem.textContent = formatTime(audio.duration);
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
            audio.addEventListener("play", function() {
                let lineIndex = 0;
                const interval = setInterval(() => {
                    if (audio.paused || audio.ended) {
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
});
