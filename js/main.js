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
    canvas.width    = canvas.clientWidth;
    canvas.height   = canvas.clientHeight;

    let mediaRecorder, audioChunks = [], audioBlob, audioUrl;
    let audioCtx, analyser, sourceNode, dataArray, startTime, animId;
    let isPlaying = false;

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
      analyser.getByteTimeDomainData(dataArray);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#333';
      ctx.beginPath();
      let x = 0;
      const slice = canvas.width / dataArray.length;
      for (let i=0; i<dataArray.length; i++) {
        const v = (dataArray[i]/128.0)*(canvas.height/2);
        if (i===0) ctx.moveTo(x,v);
        else      ctx.lineTo(x,v);
        x += slice;
      }
      ctx.lineTo(canvas.width,canvas.height/2);
      ctx.stroke();
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
            recordBtn.textContent = '⏹️';
            recordBtn.classList.add('recording');
            audio.onended = () => {
              isPlaying = false;
              recordBtn.textContent = '▶️';
              recordBtn.classList.remove('recording');
            };
            return;
          }

          // Grabar
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm; codecs=opus' });

          audioChunks = [];

          mediaRecorder.ondataavailable = e => {
            if (e.data && e.data.size > 0) {
              audioChunks.push(e.data);
            }
          };

          mediaRecorder.onstart = () => console.log('Grabación iniciada');
          mediaRecorder.onstop  = () => {
            // esperar a que los datos estén listos
            audioBlob = new Blob(audioChunks, { type:'audio/webm' });
            console.log('Blob creado:', audioBlob, 'size:', audioBlob.size);
            audioUrl = URL.createObjectURL(audioBlob);
            if (audioBlob.size > 0) {
              resetBtn.disabled = sendBtn.disabled = false;
              recordBtn.textContent = '▶️';
              recordBtn.classList.remove('recording');
            } else {
              showAlert('La grabación está vacía. Intenta nuevamente.', 5000);
            }
          };
          mediaRecorder.onerror = e => console.error(e);

          audioCtx    = new AudioContext();
          analyser    = audioCtx.createAnalyser();
          sourceNode  = audioCtx.createMediaStreamSource(stream);
          sourceNode.connect(analyser);
          analyser.fftSize = 2048;
          dataArray  = new Uint8Array(analyser.fftSize);

          mediaRecorder.start();
          startTime = Date.now();
          updateTimer();
          drawWave();

          recordBtn.textContent = '⏹️';
          recordBtn.classList.add('recording');
        } else {
          // Detener grabación
          mediaRecorder.requestData();
          mediaRecorder.stop();
          cancelAnimationFrame(animId);
          sourceNode.disconnect();
        }
      } catch(err) {
        console.error(err);
        showAlert('Activa el acceso al micrófono para dictar', 6000);
      }
    };

    // Borrar
    resetBtn.onclick = () => {
      audioChunks = [];
      audioBlob   = null;
      audioUrl    = null;
      resetBtn.disabled = sendBtn.disabled = true;
      timerEl.textContent = '00:00';
      recordBtn.textContent = '🎤';
      recordBtn.classList.remove('recording');
      isPlaying = false;
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