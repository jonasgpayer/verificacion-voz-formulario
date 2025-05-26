(function(){
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

    let mediaRecorder, audioChunks = [], audioBlob, audioUrl;
    let audioCtx, analyser, sourceNode, dataArray, startTime, animId;
    let isPlaying = false;
    let audioData = [];
    const maxDataPoints = 100; // Número máximo de puntos de datos a mostrar

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
      const barHeight = canvas.height * 0.8;
      
      ctx.fillStyle = '#4CAF50';
      
      audioData.forEach((value, index) => {
        const x = index * barWidth;
        const height = (value / 255) * barHeight;
        const y = (canvas.height - height) / 2;
        
        ctx.fillRect(x, y, barWidth - 1, height);
      });

      if (mediaRecorder && mediaRecorder.state==='recording')
        animId = requestAnimationFrame(drawWave);
    }

    // Botón Grabar / Detener / Reproducir
    recordBtn.onclick = async () => {
      try {
        if (!mediaRecorder || mediaRecorder.state === 'inactive') {
          if (audioUrl && !isPlaying) {
            // Reproducir
            const audio = new Audio(audioUrl);
            audio.play();
            isPlaying = true;
            recordBtn.querySelector('.material-icons').textContent = 'stop';
            recordBtn.classList.add('recording');
            audio.onended = () => {
              isPlaying = false;
              recordBtn.querySelector('.material-icons').textContent = 'play_arrow';
              recordBtn.classList.remove('recording');
            };
            return;
          }

          // Grabar
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
            console.log('Grabación iniciada');
            audioData = [];
          };
          
          mediaRecorder.onstop = () => {
            // esperar a que los datos estén listos
            audioBlob = new Blob(audioChunks, { type:'audio/webm' });
            console.log('Blob creado:', audioBlob, 'size:', audioBlob.size);
            
            if (audioBlob.size > 1000) { // Verificar que el blob tenga un tamaño mínimo
              audioUrl = URL.createObjectURL(audioBlob);
              resetBtn.disabled = sendBtn.disabled = false;
              recordBtn.querySelector('.material-icons').textContent = 'play_arrow';
              recordBtn.classList.remove('recording');
            } else {
              showAlert('La grabación está vacía. Intenta nuevamente.', 5000);
              // Limpiar el estado
              audioChunks = [];
              audioBlob = null;
              audioUrl = null;
              recordBtn.querySelector('.material-icons').textContent = 'mic';
              recordBtn.classList.remove('recording');
            }
          };
          
          mediaRecorder.onerror = e => {
            console.error('Error en la grabación:', e);
            showAlert('Error al grabar. Intenta nuevamente.', 5000);
          };

          audioCtx = new AudioContext();
          analyser = audioCtx.createAnalyser();
          sourceNode = audioCtx.createMediaStreamSource(stream);
          sourceNode.connect(analyser);
          analyser.fftSize = 2048;
          dataArray = new Uint8Array(analyser.frequencyBinCount);

          mediaRecorder.start(100); // Obtener datos cada 100ms
          startTime = Date.now();
          updateTimer();
          drawWave();

          recordBtn.querySelector('.material-icons').textContent = 'stop';
          recordBtn.classList.add('recording');
        } else {
          // Detener grabación
          mediaRecorder.requestData();
          mediaRecorder.stop();
          cancelAnimationFrame(animId);
          sourceNode.disconnect();
        }
      } catch(err) {
        console.error('Error al acceder al micrófono:', err);
        showAlert('Activa el acceso al micrófono para dictar', 6000);
      }
    };

    // Borrar
    resetBtn.onclick = () => {
      audioChunks = [];
      audioBlob   = null;
      audioUrl    = null;
      audioData   = [];
      resetBtn.disabled = sendBtn.disabled = true;
      timerEl.textContent = '00:00';
      recordBtn.querySelector('.material-icons').textContent = 'mic';
      recordBtn.classList.remove('recording');
      isPlaying = false;
      
      // Limpiar el canvas
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };

    // Enviar
    sendBtn.onclick = async () => {
      const formData = new FormData();
      formData.append('id', formId);
      const imgName = imgEl.src.split('/').pop().split('?')[0];
      formData.append('imageName', imgName);
      formData.append('audio', audioBlob, `${formId}.webm`);

      // DEBUG: comprueba en consola el contenido
      for (let [key, value] of formData.entries()) {
        console.log('FormData →', key, value);
      }

      await fetch(
        'https://primary-production-9647.up.railway.app/webhook-test/d7ae1b8a-ff6c-4165-bab1-93fce133608a',        
        { method:'POST', body:formData }
      );
      showAlert('Audio enviado correctamente', 4000);
    };

})(); 