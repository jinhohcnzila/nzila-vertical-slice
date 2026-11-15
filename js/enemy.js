(function (global) {
  'use strict';

  class Enemy {
    constructor(x, y) {
      this.x = x;
      this.y = y;

      this.width = 32;
      this.height = 48;

      this.maxHp = 75;
      this.hp = 75;

      this.speed = 120;

      this.dead = false;
      this.remove = false;

      this.deathTimer = 1.2;
    }

    getBounds() {
      return {
        x: this.x - this.width / 2,
        y: this.y - this.height / 2,
        width: this.width,
        height: this.height
      };
    }

    takeDamage(amount) {
      if (this.dead) return;

      this.hp -= amount;

      if (this.hp <= 0) {
        this.hp = 0;
        this.dead = true;
      }
    }

    intersects(rectA, rectB) {
      return (
        rectA.x < rectB.x + rectB.width &&
        rectA.x + rectA.width > rectB.x &&
        rectA.y < rectB.y + rectB.height &&
        rectA.y + rectA.height > rectB.y
      );
    }

    update(dt, player) {
      if (this.dead) {
        this.deathTimer -= dt;

        if (this.deathTimer <= 0) {
          this.remove = true;
        }

        return;
      }

      const dx = player.x - this.x;
      const dy = player.y - this.y;

      const distance = Math.hypot(dx, dy);

      if (distance < 300) {
        this.x += (dx / distance) * this.speed * dt;
        this.y += (dy / distance) * this.speed * dt;
      }

      if (player.isAttacking) {
        const hitbox = player.getAttackHitbox();

        if (
          this.intersects(
            hitbox,
            this.getBounds()
          )
        ) {
          this.takeDamage(15);
        }
      }
    }

    draw(ctx) {
      const b = this.getBounds();

      ctx.fillStyle = this.dead ? '#888' : '#ffffff';

      ctx.fillRect(
        b.x,
        b.y,
        b.width,
        b.height
      );

      // HP
      ctx.fillStyle = '#000';

      ctx.fillRect(
        b.x,
        b.y - 10,
        b.width,
        4
      );

      ctx.fillStyle = '#ff0000';

      ctx.fillRect(
        b.x,
        b.y - 10,
        (this.hp / this.maxHp) * b.width,
        4
      );
    }
  }

  global.Enemy = Enemy;
})(window);
