(function (global) {

  class Enemy {

    constructor(x, y) {

      this.x = x;
      this.y = y;

      this.width = 80;
      this.height = 80;

      this.remove = false;
    }

    update(dt, player) {

    }

    draw(ctx) {

      ctx.fillStyle = "#FFFFFF";

      ctx.fillRect(
        this.x,
        this.y,
        this.width,
        this.height
      );
    }
  }

  global.Enemy = Enemy;

})(window);
