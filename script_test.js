document.addEventListener('DOMContentLoaded', () => {
    fetchRSS();
    fetchWeather();
    fetchCalendar();
});

function fetchRSS() {
    const rssUrl = 'https://techcrunch.com/feed/'; // TechCrunch RSS feed URL
    fetch(rssUrl)
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.text();
        })
        .then(str => new window.DOMParser().parseFromString(str, 'text/xml'))
        .then(data => {
            console.log(data); // Log the raw XML data for debugging
            const items = data.querySelectorAll('item');
            const newsContainer = document.getElementById('news-container');
            newsContainer.innerHTML = ''; // Clear the container first
            items.forEach(item => {
                const title = item.querySelector('title').textContent;
                const description = item.querySelector('description').textContent;
                const link = item.querySelector('link').textContent;
                
                const articleElement = document.createElement('div');
                articleElement.innerHTML = `<h3><a href="${link}" target="_blank">${title}</a></h3><p>${description}</p>`;
                newsContainer.appendChild(articleElement);
            });
        })
        .catch(error => console.error('Error fetching RSS feed:', error));
}

function fetchWeather() {
    // Example: Fetch weather from an API
    fetch('https://api.openweathermap.org/data/2.5/weather?q=Copenhagen&appid=YOUR_API_KEY')
        .then(response => response.json())
        .then(data => {
            const weatherContainer = document.getElementById('weather-container');
            weatherContainer.innerHTML = `<p>${data.weather[0].description}</p><p>Temperature: ${data.main.temp}°C</p>`;
        });
}

function fetchCalendar() {
    // Example: Fetch events from a calendar API (mock data here)
    const events = [
        { time: '09:00 AM', event: 'Meeting with team' },
        { time: '01:00 PM', event: 'Lunch with client' },
        { time: '03:00 PM', event: 'Project review' }
    ];
    const calendarContainer = document.getElementById('calendar-container');
    events.forEach(event => {
        const eventElement = document.createElement('div');
        eventElement.innerHTML = `<p>${event.time} - ${event.event}</p>`;
        calendarContainer.appendChild(eventElement);
    });
}
