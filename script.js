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
        } else {
            audio.pause();
            playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
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

    const imagePaths = ['image1.jpg', 'image2.jpg', 'image3.jpg', 'image4.jpg'];
    const colors = ['#ffb6c1','#f0f8ff', '#ffe4b5', '#98fb98', '#ffb6c1'];

    function changeBackground() {
        const currentTime = audio.currentTime;
        let index;
        if (currentTime < 10) {
            index = 0;
        } else if (currentTime >= 10 && currentTime < 20) {
            index = 1;
        } else if (currentTime >= 20 && currentTime < 30) {
            index = 2;
        } else {
            index = 3;
        }
        const imagePath = imagePaths[index];
        const img = new Image();
        img.src = imagePath;
        img.onload = function() {
            document.body.style.backgroundImage = `url('${imagePath}')`;
        };
        img.onerror = function() {
            document.body.style.backgroundImage = 'none';
            document.body.style.backgroundColor = colors[index];
        };
    }

    audio.addEventListener("play", function() {
        setInterval(changeBackground, 1000);
    });
});
