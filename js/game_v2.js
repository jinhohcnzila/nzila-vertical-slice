(function () {

  const canvas =
    document.querySelector("canvas");

  const ctx =
    canvas.getContext("2d");

  const player =
    new Player({
      x: 250,
      y: 300,
      bounds: {
        width: canvas.width,
        height: canvas.height
      }
    });

  let enemy =
    new Enemy(
      600,
      300
    );

  let last = 0;

  function drawBackground() {

    ctx.fillStyle =
      "#1b1320";

    ctx.fillRect(
      0,
      0,
      canvas.width,
      canvas.height
    );
  }

  function loop(timestamp) {

    const dt =
      Math.min(
        (timestamp - last) / 1000,
        0.05
      );

    last = timestamp;

    drawBackground();

    player.update(dt);

    if (enemy) {

      enemy.update(
        dt,
        player
      );

      if (enemy.remove) {
        enemy = null;
      }
    }

    player.draw(ctx);

    if (enemy) {
      enemy.draw(ctx);
    }

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);

})();
alert("GAME V2 ATIVO");
