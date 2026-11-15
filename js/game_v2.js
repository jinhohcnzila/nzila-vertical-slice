(function () {

  const canvas =
    document.querySelector("canvas");

  const ctx =
    canvas.getContext("2d");

  const player =
    new Player({
      x: 200,
      y: 300,
      bounds: {
        width: canvas.width,
        height: canvas.height
      }
    });

  const enemy =
    new Enemy(
      700,
      300
    );

  let last = 0;

  function loop(timestamp) {

    const dt =
      (timestamp - last) / 1000;

    last = timestamp;

    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    ctx.fillStyle =
      "#704728";

    ctx.fillRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    player.update(dt);
    enemy.update(
      dt,
      player
    );

    player.draw(ctx);

    if (!enemy.remove) {
      enemy.draw(ctx);
    }

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);

})();
