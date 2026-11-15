(function (global) {
  'use strict';

  class Enemy {
    constructor(x, y) {
      this.x = x;
      this.y = y;

      this.width = 32;
      this.height = 48;

      this.hp = 75;
      this.maxHp = 75;

      this.speed = 100;

      this.dead = false;
      this.remove = false;

      this.deathTime = 1;
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

    update(dt, player) {

      if (this.dead) {
        this.deathTime -= dt;

        if (this.deathTime <= 0) {
          this.remove = true;
        }

        return;
      }

      const dx = player.x - this.x;
      const dy = player.y - this.y;

      const distance = Math.hypot(dx, dy);

      if (distance > 5) {
        this.x += (dx / distance) * this.speed * dt;
        this.y += (dy / distance) * this.speed * dt;
      }

      if (player.isAttacking) {

        const hitbox = player.getAttackHitbox();
        const enemyBox = this.getBounds();

        if (
          hitbox.x < enemyBox.x + enemyBox.width &&
          hitbox.x + hitbox.width > enemyBox.x &&
          hitbox.y < enemyBox.y + enemyBox.height &&
          hitbox.y + hitbox.height > enemyBox.y
        ) {
          this.takeDamage(10);
        }
      }
    }

    draw(ctx) {

      const b = this.getBounds();

      ctx.fillStyle = this.dead ? '#777777' : '#FFFFFF';

      ctx.fillRect(
        b.x,
        b.y,
        b.width,
        b.height
      );

      ctx.fillStyle = '#000';

      ctx.fillRect(
        b.x,
        b.y - 8,
        b.width,
        4
      );

      ctx.fillStyle = '#ff3333';

      ctx.fillRect(
        b.x,
        b.y - 8,
        (this.hp / this.maxHp) * b.width,
        4
      );
    }
  }

  global.Enemy = Enemy;

})(window);
