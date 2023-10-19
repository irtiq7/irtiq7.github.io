//Pitch Detection
let model_url = 'https://cdn.jsdelivr.net/gh/ml5js/ml5-data-and-models/models/pitch-detection/crepe'
let pitch;
let audioContext;
let mic;
let freq = 0;

let stringTone;
let stringName;

function setup() {
  //console.log(ml5.version);
  audioContext = getAudioContext();
  mic = new p5.AudioIn();
  mic.start(listening);

  frameRate(10);



}

function listening() {
  console.log('listening');
  pitch = ml5.pitchDetection(
    model_url,
    audioContext,
    mic.stream,
    modelLoaded);
}

function modelLoaded() {
  console.log('model loaded');
  pitch.getPitch(gotPitch);
}


function gotPitch(error, frequency) {
  if (error) {
    console.error(error);
  } else {
    if (frequency) {
      freq = frequency;
    }

  }
  pitch.getPitch(gotPitch);
}


function draw() {
  background(0);
  stroke(600, 300, 300);
  strokeWeight(2)
  noFill();
  noStroke();

  textAlign(CENTER, CENTER);
  fill(255);
  textSize(20);
  text(freq.toFixed(2), width/2, height/2);

  console.log(freq);

  if (freq >= 392 ) {
    console.log('hereherhere!')
    fill('white');
    textAlign(CENTER / 4, CENTER / 4);
    text('G4!', width / 4, height / 4 );
  } else if (freq.toFixed(2) < 261.63) {

    fill('red');
    textAlign(CENTER, CENTER);
    text('C4!', width / 4, height - 180);
  } else if (freq.toFixed(2) == 329) {

    fill('red');
    textAlign(CENTER, CENTER);
    text('E4!', width / 4, height - 180);
  }

}