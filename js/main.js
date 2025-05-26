(function(){
    // 0) Estados de la aplicación
    const STATES = {
        IDLE: 'IDLE', // Estado inicial, sin grabación
        RECORDING: 'RECORDING', // Grabando audio
        STOPPED: 'STOPPED', // Grabación detenida, lista para reproducir/enviar
        PLAYING: 'PLAYING' // Reproduciendo audio grabado
    };
    let currentState = STATES.IDLE;
    let audioDuration = 0; // Duración del audio grabado en milisegundos

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
        canvas.width = Math.max(containerWidth, 100); // Asegurar un ancho mínimo
        canvas.height = canvas.clientHeight || 50; // Asegurar una altura mínima
        drawSilentWaveform(); // Dibujar forma de onda silenciosa al inicio y al redimensionar
    }
    
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    let mediaRecorder, audioChunks = [], audioBlob, audioUrl;
    let audioCtx, analyser, sourceNode, dataArray, animationFrameId;
    let recordingStartTime, playbackStartTime;
    let currentAudioElement; // Para controlar la reproducción

    const MAX_DATA_POINTS = 50; // Para el visualizador
    let audioDataPoints = []; // Puntos de datos para el visualizador

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

    function formatTime(milliseconds) {
        const totalSeconds = Math.floor(milliseconds / 1000);
        const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
        const seconds = String(totalSeconds % 60).padStart(2, '0');
        return `${minutes}:${seconds}`;
    }

    // Temporizador
    function updateTimer() {
        let elapsedTime;
        if (currentState === STATES.RECORDING) {
            elapsedTime = Date.now() - recordingStartTime;
            timerEl.textContent = formatTime(elapsedTime);
            animationFrameId = requestAnimationFrame(updateTimer);
        } else if (currentState === STATES.PLAYING) {
            elapsedTime = Date.now() - playbackStartTime;
            // Limitar el tiempo de reproducción a la duración del audio
            if (elapsedTime >= audioDuration) {
                elapsedTime = audioDuration;
                stopPlayback(); // Detener automáticamente al final
            }
            timerEl.textContent = formatTime(elapsedTime);
            if (currentState === STATES.PLAYING) { // Verificar de nuevo porque stopPlayback cambia el estado
                animationFrameId = requestAnimationFrame(updateTimer);
            }
        }
    }
    
    function drawSilentWaveform() {
        if (!canvas || !ctx) return;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    function drawWaveform() {
        if (!analyser || !dataArray || !ctx || !canvas) return;
        analyser.getByteFrequencyData(dataArray);
      
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
        }
        const average = dataArray.length > 0 ? sum / dataArray.length : 0;
      
        audioDataPoints.push(average);
        if (audioDataPoints.length > MAX_DATA_POINTS) {
            audioDataPoints.shift();
        }

        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      
        const barWidth = canvas.width / MAX_DATA_POINTS;
        const barHeight = canvas.height * 0.95;
      
        ctx.fillStyle = '#4CAF50';
      
        audioDataPoints.forEach((value, index) => {
            const x = index * barWidth;
            const height = Math.max(1, (value / 255) * barHeight * 1.5); // Asegurar altura mínima de 1px
            const y = (canvas.height - height) / 2;
            ctx.fillRect(x, y, Math.max(1, barWidth - 1), height); //Asegurar ancho mínimo de 1px
        });

        if (currentState === STATES.RECORDING || currentState === STATES.PLAYING) {
            animationFrameId = requestAnimationFrame(drawWaveform);
        }
    }
    
    function startVisualization() {
        audioDataPoints = []; // Limpiar datos anteriores
        if (currentState === STATES.RECORDING && mediaRecorder && mediaRecorder.stream) {
            if (!audioCtx) audioCtx = new AudioContext();
            if (sourceNode) sourceNode.disconnect(); // Desconectar anterior si existe
            if (analyser) analyser.disconnect(); // Desconectar anterior si existe

            sourceNode = audioCtx.createMediaStreamSource(mediaRecorder.stream);
            analyser = audioCtx.createAnalyser();
            sourceNode.connect(analyser);
            analyser.fftSize = 2048; // Puede ajustarse según necesidad
            dataArray = new Uint8Array(analyser.frequencyBinCount);
            drawWaveform();
        } else if (currentState === STATES.PLAYING && currentAudioElement) {
             if (!audioCtx) audioCtx = new AudioContext();
             if (sourceNode) sourceNode.disconnect();
             if (analyser) analyser.disconnect();

            // Crear source desde el elemento de audio para visualización durante la reproducción
            sourceNode = audioCtx.createMediaElementSource(currentAudioElement);
            analyser = audioCtx.createAnalyser();
            sourceNode.connect(analyser);
            analyser.connect(audioCtx.destination); // Conectar al destino para que se escuche
            analyser.fftSize = 2048;
            dataArray = new Uint8Array(analyser.frequencyBinCount);
            drawWaveform();
        }
    }

    function stopVisualization() {
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
        if (sourceNode) {
            sourceNode.disconnect();
            sourceNode = null;
        }
        if (analyser) {
            analyser.disconnect();
            // analyser = null; // No es necesario, se recrea
        }
        // No cerrar audioCtx aquí para permitir múltiples grabaciones/reproducciones
        // se podría cerrar al eliminar todo o al salir de la página.
    }

    function updateUI() {
        switch (currentState) {
            case STATES.IDLE:
                recordBtn.querySelector('.material-icons').textContent = 'mic';
                recordBtn.classList.remove('recording', 'playing');
                resetBtn.disabled = true;
                sendBtn.disabled = true;
                timerEl.textContent = '00:00';
                drawSilentWaveform();
                break;
            case STATES.RECORDING:
                recordBtn.querySelector('.material-icons').textContent = 'stop';
                recordBtn.classList.add('recording');
                recordBtn.classList.remove('playing');
                resetBtn.disabled = true;
                sendBtn.disabled = true;
                // El timer y waveform se actualizan en sus respectivos bucles
                break;
            case STATES.STOPPED:
                recordBtn.querySelector('.material-icons').textContent = 'play_arrow';
                recordBtn.classList.remove('recording', 'playing');
                resetBtn.disabled = false;
                sendBtn.disabled = false;
                timerEl.textContent = formatTime(audioDuration); // Mostrar duración total
                // Mantener la última forma de onda o una representativa.
                // Por ahora, se detiene la animación. Si se quisiera mantener, sería diferente.
                break;
            case STATES.PLAYING:
                recordBtn.querySelector('.material-icons').textContent = 'stop';
                recordBtn.classList.add('playing');
                recordBtn.classList.remove('recording');
                resetBtn.disabled = false; // Puede que el usuario quiera borrar mientras reproduce
                sendBtn.disabled = false;   // O enviar
                // El timer y waveform se actualizan en sus respectivos bucles
                break;
        }
    }
    
    async function startRecording() {
        if (currentState !== STATES.IDLE && currentState !== STATES.STOPPED) return;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: false
                }
            });
            
            // Asegurarse de que el AudioContext esté activo
            if (audioCtx && audioCtx.state === 'suspended') {
                await audioCtx.resume();
            } else if (!audioCtx) {
                audioCtx = new AudioContext();
            }

            mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm; codecs=opus',
                audioBitsPerSecond: 128000
            });
            mediaRecorder.stream = stream; // Guardar referencia al stream para el visualizador

            audioChunks = [];
            audioDataPoints = []; // Limpiar visualización anterior

            mediaRecorder.ondataavailable = e => {
                if (e.data && e.data.size > 0) {
                    audioChunks.push(e.data);
                }
            };

            mediaRecorder.onstart = () => {
                console.log('Grabación iniciada');
                currentState = STATES.RECORDING;
                recordingStartTime = Date.now();
                updateTimer();
                startVisualization();
                updateUI();
            };

            mediaRecorder.onstop = () => {
                console.log('Grabación detenida');
                if (mediaRecorder && mediaRecorder.stream) {
                    mediaRecorder.stream.getTracks().forEach(track => track.stop()); // Detener tracks del micrófono
                    mediaRecorder.stream = null;
                }
                
                if (audioChunks.length === 0) {
                    console.warn("No se grabaron datos de audio.");
                    showAlert('La grabación está vacía. Intenta nuevamente.', 5000);
                    resetRecording(); // Volver al estado IDLE
                    return;
                }

                audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                console.log('Blob creado:', audioBlob, 'size:', audioBlob.size);

                if (audioBlob.size > 1000) { // Verificar tamaño mínimo
                    audioUrl = URL.createObjectURL(audioBlob);
                    // Calcular duración del audio
                    const tempAudio = new Audio(audioUrl);
                    tempAudio.onloadedmetadata = () => {
                        audioDuration = tempAudio.duration * 1000; // en milisegundos
                        currentState = STATES.STOPPED;
                        stopVisualization(); // Detener visualización de grabación
                        updateUI();
                    };
                    tempAudio.onerror = () => {
                         console.error("Error al cargar metadatos del audio para duración.");
                         // Asumir una duración de 0 o manejar el error como se prefiera
                         audioDuration = 0;
                         currentState = STATES.STOPPED;
                         stopVisualization();
                         updateUI();
                    }
                } else {
                    showAlert('La grabación está vacía o es muy corta. Intenta nuevamente.', 5000);
                    resetRecording(); // Limpiar y volver a IDLE
                }
            };

            mediaRecorder.onerror = e => {
                console.error('Error en la grabación:', e);
                showAlert('Error al grabar. Verifica permisos del micrófono.', 5000);
                resetRecording();
            };

            mediaRecorder.start(100); // Obtener datos cada 100ms para ondataavailable
        } catch (err) {
            console.error('Error al acceder al micrófono:', err);
            if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
                showAlert('Acceso al micrófono denegado. Habilita los permisos en tu navegador.', 6000);
            } else {
                showAlert('Activa el acceso al micrófono para grabar', 6000);
            }
            resetRecording(); // Asegurarse de volver a un estado consistente
        }
    }

    function stopRecording() {
        if (currentState !== STATES.RECORDING || !mediaRecorder) return;
        mediaRecorder.stop();
        // El estado y la UI se actualizan en mediaRecorder.onstop
        // stopVisualization() se llamará desde onstop también.
    }

    function startPlayback() {
        if (currentState !== STATES.STOPPED || !audioUrl) return;

        // Asegurarse de que el AudioContext esté activo para la visualización
        if (audioCtx && audioCtx.state === 'suspended') {
             audioCtx.resume().then(() => {
                actuallyStartPlayback();
             });
        } else if (!audioCtx) {
            audioCtx = new AudioContext();
            actuallyStartPlayback();
        }
        else {
            actuallyStartPlayback();
        }
    }
    
    function actuallyStartPlayback() {
        currentAudioElement = new Audio(audioUrl);
        currentAudioElement.oncanplaythrough = () => { // Asegurar que el audio puede reproducirse
            currentState = STATES.PLAYING;
            playbackStartTime = Date.now();
            
            currentAudioElement.play();
            startVisualization(); // Iniciar visualización para reproducción
            updateTimer();
            updateUI();
        };

        currentAudioElement.onended = () => {
            stopPlayback(false); // No reiniciar el contador a 00:00, sino a la duración total
        };

        currentAudioElement.onerror = (e) => {
            console.error('Error al reproducir:', e);
            showAlert('Error al reproducir el audio.', 5000);
            stopPlayback(true); // Error, sí reiniciar a IDLE si es necesario o a STOPPED
        };
    }


    function stopPlayback(encounteredError = false) {
        if (currentState !== STATES.PLAYING && !currentAudioElement) return;

        if (currentAudioElement) {
            currentAudioElement.pause();
            currentAudioElement.currentTime = 0; // Reiniciar para la próxima reproducción
            // currentAudioElement = null; // No anularlo aquí, puede ser necesario para el visualizador
        }
        
        stopVisualization(); // Detener visualización de reproducción
        cancelAnimationFrame(animationFrameId); // Detener bucle de timer si estaba activo
        
        if (encounteredError) {
            // Si hubo un error, podría ser mejor volver al estado IDLE o manejarlo específicamente
            // Por ahora, volvemos a STOPPED si hay audio, o IDLE si no.
             currentState = audioBlob ? STATES.STOPPED : STATES.IDLE;
        } else {
            currentState = STATES.STOPPED;
        }
        updateUI(); // Actualiza la UI, incluyendo el timer a la duración total desde STOPPED
    }

    function resetRecording() {
        if (currentAudioElement) {
            currentAudioElement.pause();
            currentAudioElement = null;
        }
        if (mediaRecorder && (mediaRecorder.state === 'recording' || mediaRecorder.state === 'paused')) {
            mediaRecorder.stop(); // Detener grabación si está activa
        }
        if (mediaRecorder && mediaRecorder.stream) {
            mediaRecorder.stream.getTracks().forEach(track => track.stop());
            mediaRecorder.stream = null;
        }

        stopVisualization(); // Detener cualquier visualización
        if (animationFrameId) cancelAnimationFrame(animationFrameId);


        audioChunks = [];
        audioBlob = null;
        if (audioUrl) {
            URL.revokeObjectURL(audioUrl);
            audioUrl = null;
        }
        audioDataPoints = [];
        audioDuration = 0;
        
        // No cerrar audioCtx aquí para permitir futuras grabaciones.
        // Podría cerrarse si se detecta que la página se va a cerrar o si hay un botón de "limpiar todo" explícito.

        currentState = STATES.IDLE;
        updateUI();
        drawSilentWaveform(); // Asegurar que el canvas esté limpio
        console.log("Grabación reseteada");
    }

    // Event Listeners
    recordBtn.onclick = async () => {
        // Si el AudioContext está suspendido (navegadores modernos lo inician así)
        // se debe reanudar con una interacción del usuario.
        if (audioCtx && audioCtx.state === 'suspended') {
            await audioCtx.resume();
        }

        switch (currentState) {
            case STATES.IDLE:
            case STATES.STOPPED: // Si está detenido, el botón de "mic" o "play" significa grabar o reproducir
                if (audioUrl && currentState === STATES.STOPPED) { // Hay algo que reproducir
                    startPlayback();
                } else { // No hay nada o se quiere (re)grabar
                    resetRecording(); // Limpia por si acaso había algo y el estado era STOPPED
                    startRecording();
                }
                break;
            case STATES.RECORDING:
                stopRecording();
                break;
            case STATES.PLAYING:
                stopPlayback(false); // Detener reproducción, no es un error
                break;
        }
    };

    resetBtn.onclick = () => {
        resetRecording();
        showAlert('Grabación eliminada.', 3000);
    };

    sendBtn.onclick = async () => {
        if (currentState !== STATES.STOPPED || !audioBlob) {
            showAlert('No hay grabación para enviar o la grabación está en curso.', 4000);
            return;
        }
        if (audioBlob.size < 1000) {
             showAlert('La grabación es demasiado corta para enviar.', 4000);
            return;
        }

        sendBtn.disabled = true; // Deshabilitar mientras se envía
        const formData = new FormData();
        formData.append('id', formId);
        const imgName = imgEl.src.split('/').pop().split('?')[0];
        formData.append('imageName', imgName);
        formData.append('audio', audioBlob, `${formId}.webm`);

        console.log('Enviando FormData:');
        for (let [key, value] of formData.entries()) {
            console.log(key, value);
        }

        try {
            const response = await fetch(
                'https://primary-production-9647.up.railway.app/webhook-test/d7ae1b8a-ff6c-4165-bab1-93fce133608a',
                { method: 'POST', body: formData }
            );
            if (response.ok) {
                showAlert('Audio enviado correctamente.', 4000);
                resetRecording(); // Limpiar después de enviar exitosamente
            } else {
                const errorText = await response.text();
                showAlert(`Error al enviar: ${response.status} ${errorText || ''}`, 5000);
                sendBtn.disabled = false; // Habilitar de nuevo si falló
            }
        } catch (error) {
            console.error('Error en fetch:', error);
            showAlert('Error de red al enviar el audio.', 5000);
            sendBtn.disabled = false; // Habilitar de nuevo si falló
        }
    };

    // Inicializar UI al cargar
    updateUI();
    drawSilentWaveform(); // Asegurar canvas limpio al inicio

})(); 