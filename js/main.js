// v1.0.0
(function(){
    // Estado global
    const STATE = {
        IDLE: 'idle',
        RECORDING: 'recording',
        RECORDED: 'recorded',
        PLAYING: 'playing'
    };

    let currentState = STATE.IDLE;
    let mediaRecorder, audioChunks = [], audioBlob, audioUrl;
    let audioCtx, analyser, sourceNode, dataArray, startTime, animId;
    let audioData = [];
    const maxDataPoints = 50;

    // 1) Parametrización e imagen
    const params = new URLSearchParams(window.location.search);
    let formId = params.get('id');
    if (!formId) {
      const segs = window.location.pathname.split('/');
      formId = segs.pop() || segs.pop();
    }
    const imgEl = document.getElementById('prompt-image');
    const ts = Date.now();
    imgEl.src = `https://jonasgpayer.github.io/verificacion-voz-formulario/images/${formId}.png?ts=${ts}`;

    // 2) UI y Canvas
    const recordBtn = document.getElementById('record-btn');
    const resetBtn  = document.getElementById('reset-btn');
    const sendBtn   = document.getElementById('send-btn');
    const timerEl   = document.getElementById('timer');
    const canvas    = document.getElementById('waveform');
    const ctx       = canvas.getContext('2d');
    
    // Ajustar tamaño del canvas
    function resizeCanvas() {
        const container = canvas.parentElement;
        const containerWidth = container.clientWidth - 180; // Restar espacio para botones y timer
        canvas.width = containerWidth;
        canvas.height = canvas.clientHeight;
    }
    
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    let isPlaying = false;
    let recordingInterval;

    // Función de alerta
    function showAlert(message, duration = 5000) {
      const c = document.getElementById('alert-container');
      c.textContent = message;
      c.style.display = 'block';
      clearTimeout(c.hideTimeout);
      c.hideTimeout = setTimeout(() => {
        c.style.display = 'none';
      }, duration);
    }

    // Temporizador y waveform
    function updateTimer(){
      const diff = Date.now() - startTime;
      const s = String(Math.floor(diff/1000)).padStart(2,'0');
      const m = String(Math.floor(diff/60000)).padStart(2,'0');
      timerEl.textContent = `${m}:${s}`;
      if (mediaRecorder && mediaRecorder.state==='recording')
        requestAnimationFrame(updateTimer);
    }

    function drawWave(){
      analyser.getByteFrequencyData(dataArray);
      
      // Calcular la amplitud promedio
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const average = sum / dataArray.length;
      
      // Agregar nuevo punto de datos
      audioData.push(average);
      if (audioData.length > maxDataPoints) {
        audioData.shift();
      }

      // Dibujar el visualizador
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      const barWidth = canvas.width / maxDataPoints;
      const barHeight = canvas.height * 0.95; // Aumentado de 0.8 a 0.95 para usar más espacio vertical
      
      ctx.fillStyle = '#4CAF50';
      
      audioData.forEach((value, index) => {
        const x = index * barWidth;
        // Aumentar la sensibilidad multiplicando el valor por 1.5
        const height = (value / 255) * barHeight * 1.5;
        const y = (canvas.height - height) / 2;
        
        ctx.fillRect(x, y, barWidth - 1, height);
      });
    }

    function startVisualization() {
      drawWave();
      if (mediaRecorder && mediaRecorder.state==='recording') {
        animId = requestAnimationFrame(startVisualization);
      }
    }

    // Función para actualizar el estado de los botones
    function updateButtonStates() {
        switch(currentState) {
            case STATE.IDLE:
                recordBtn.querySelector('.material-icons').textContent = 'mic';
                recordBtn.classList.remove('recording');
                resetBtn.disabled = true;
                sendBtn.disabled = true;
                break;
            case STATE.RECORDING:
                recordBtn.querySelector('.material-icons').textContent = 'stop';
                recordBtn.classList.add('recording');
                resetBtn.disabled = true;
                sendBtn.disabled = true;
                break;
            case STATE.RECORDED:
                recordBtn.querySelector('.material-icons').textContent = 'play_arrow';
                recordBtn.classList.remove('recording');
                resetBtn.disabled = false;
                sendBtn.disabled = false;
                break;
            case STATE.PLAYING:
                recordBtn.querySelector('.material-icons').textContent = 'stop';
                recordBtn.classList.add('recording');
                resetBtn.disabled = false;
                sendBtn.disabled = false;
                break;
        }
    }

    // Función para limpiar recursos
    function cleanupResources() {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }
        if (sourceNode) {
            sourceNode.disconnect();
        }
        if (audioCtx) {
            audioCtx.close();
        }
        if (animId) {
            cancelAnimationFrame(animId);
        }
        if (audioUrl) {
            URL.revokeObjectURL(audioUrl);
        }
    }

    // Función para limpiar el estado
    function resetState() {
        cleanupResources();
        audioChunks = [];
        audioBlob = null;
        audioUrl = null;
        audioData = [];
        currentState = STATE.IDLE;
        updateButtonStates();
        timerEl.textContent = '00:00';
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Botón Grabar / Detener / Reproducir
    recordBtn.onclick = async () => {
        try {
            switch(currentState) {
                case STATE.IDLE:
                    // Iniciar grabación
                    const stream = await navigator.mediaDevices.getUserMedia({ 
                        audio: {
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true
                        } 
                    });
                    
                    mediaRecorder = new MediaRecorder(stream, { 
                        mimeType: 'audio/webm; codecs=opus',
                        audioBitsPerSecond: 128000
                    });

                    audioChunks = [];
                    audioData = [];

                    mediaRecorder.ondataavailable = e => {
                        if (e.data && e.data.size > 0) {
                            audioChunks.push(e.data);
                        }
                    };

                    mediaRecorder.onstart = () => {
                        currentState = STATE.RECORDING;
                        updateButtonStates();
                        startTime = Date.now();
                        updateTimer();
                        startVisualization();
                    };
                    
                    mediaRecorder.onstop = () => {
                        audioBlob = new Blob(audioChunks, { type:'audio/webm' });
                        
                        if (audioBlob.size > 1000) {
                            audioUrl = URL.createObjectURL(audioBlob);
                            currentState = STATE.RECORDED;
                            updateButtonStates();
                        } else {
                            showAlert('La grabación está vacía. Intenta nuevamente.', 5000);
                            resetState();
                        }
                    };

                    audioCtx = new AudioContext();
                    analyser = audioCtx.createAnalyser();
                    sourceNode = audioCtx.createMediaStreamSource(stream);
                    sourceNode.connect(analyser);
                    analyser.fftSize = 2048;
                    dataArray = new Uint8Array(analyser.frequencyBinCount);

                    mediaRecorder.start(100);
                    break;

                case STATE.RECORDING:
                    // Detener grabación
                    mediaRecorder.stop();
                    cancelAnimationFrame(animId);
                    sourceNode.disconnect();
                    break;

                case STATE.RECORDED:
                    // Reproducir grabación
                    const audio = new Audio(audioUrl);
                    currentState = STATE.PLAYING;
                    updateButtonStates();
                    
                    audio.play();
                    startTime = Date.now();
                    updateTimer();
                    startVisualization();
                    
                    audio.onended = () => {
                        currentState = STATE.RECORDED;
                        updateButtonStates();
                        timerEl.textContent = '00:00';
                    };

                    audio.onerror = (e) => {
                        console.error('Error al reproducir:', e);
                        showAlert('Error al reproducir el audio', 5000);
                        currentState = STATE.RECORDED;
                        updateButtonStates();
                        timerEl.textContent = '00:00';
                    };
                    break;

                case STATE.PLAYING:
                    // Detener reproducción
                    currentState = STATE.RECORDED;
                    updateButtonStates();
                    timerEl.textContent = '00:00';
                    break;
            }
        } catch(err) {
            console.error('Error:', err);
            showAlert('Error al acceder al micrófono', 6000);
            resetState();
        }
    };

    // Borrar
    resetBtn.onclick = () => {
        resetState();
    };

    // Enviar
    sendBtn.onclick = async () => {
        if (currentState !== STATE.RECORDED) {
            showAlert('Debes grabar un audio antes de enviar', 4000);
            return;
        }

        const formData = new FormData();
        formData.append('id', formId);
        const imgName = imgEl.src.split('/').pop().split('?')[0];
        formData.append('imageName', imgName);
        formData.append('audio', audioBlob, `${formId}.webm`);

        try {
            await fetch(
                'https://primary-production-9647.up.railway.app/webhook-test/d7ae1b8a-ff6c-4165-bab1-93fce133608a',        
                { method:'POST', body:formData }
            );
            showAlert('Audio enviado correctamente', 4000);
        } catch (error) {
            console.error('Error al enviar:', error);
            showAlert('Error al enviar el audio', 4000);
        }
    };

})(); 