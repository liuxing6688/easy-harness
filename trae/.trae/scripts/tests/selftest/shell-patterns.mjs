/**
 * P2-4：Shell 门禁模式表回归——主流包管理器、脚手架与管道安装命令的命中/不误报。
 *
 * 校验 `isGatedShellCommand`（见 hooks/lib/core.mjs → getMergedShellPatterns）
 * 对跨技术栈包管理器（npm/pnpm/yarn/bun/pip/poetry/uv/cargo/go/gem/composer/deno 等）
 * 与管道安装模式（curl|sh、wget|sh、iwr|iex）的识别覆盖，以及对普通非门禁命令的不误报。
 *
 * 入口：node .trae/scripts/gate-selftest.mjs
 * 脚手架：./_harness.mjs；共享 fixture：./_fixtures.mjs
 */
import {
  test, assert,
  isGatedShellCommand,
} from './_harness.mjs';

console.log('== P2-4 Shell 门禁模式表：主流包管理器与管道安装 ==');

test('P2-4: npm create / install 命中（既有基线）', () => {
  assert.equal(isGatedShellCommand('npm create vite@latest'), true);
  assert.equal(isGatedShellCommand('npm install'), true);
  assert.equal(isGatedShellCommand('npm ci'), true);
});

test('P2-4: pnpm / yarn / bun 包管理器命中', () => {
  assert.equal(isGatedShellCommand('pnpm install'), true);
  assert.equal(isGatedShellCommand('pnpm add react'), true);
  assert.equal(isGatedShellCommand('pnpm create vite'), true);
  assert.equal(isGatedShellCommand('yarn install'), true);
  assert.equal(isGatedShellCommand('yarn add lodash'), true);
  assert.equal(isGatedShellCommand('yarn create app'), true);
  assert.equal(isGatedShellCommand('bun install'), true);
  assert.equal(isGatedShellCommand('bun add react'), true);
  assert.equal(isGatedShellCommand('bun create app'), true);
});

test('P2-4: npx create-* 命中', () => {
  assert.equal(isGatedShellCommand('npx create-vite@latest'), true);
  assert.equal(isGatedShellCommand('npx create-react-app my-app'), true);
  assert.equal(isGatedShellCommand('npx @some/scoped-cli init'), true);
});

test('P2-4: Python 包管理器命中（pip / pip3 / python -m pip）', () => {
  assert.equal(isGatedShellCommand('pip install requests'), true);
  assert.equal(isGatedShellCommand('pip3 install flask'), true);
  assert.equal(isGatedShellCommand('python -m pip install django'), true);
  assert.equal(isGatedShellCommand('python3 -m pip install pytest'), true);
  assert.equal(isGatedShellCommand('poetry add fastapi'), true);
  assert.equal(isGatedShellCommand('poetry install'), true);
  assert.equal(isGatedShellCommand('uv pip install httpx'), true);
  assert.equal(isGatedShellCommand('uv add pydantic'), true);
  assert.equal(isGatedShellCommand('conda install numpy'), true);
});

test('P2-4: Rust / Go / Ruby / PHP / Deno 包管理器命中', () => {
  assert.equal(isGatedShellCommand('cargo install ripgrep'), true);
  assert.equal(isGatedShellCommand('cargo add serde'), true);
  assert.equal(isGatedShellCommand('cargo new myproject'), true);
  assert.equal(isGatedShellCommand('go get github.com/pkg/errors'), true);
  assert.equal(isGatedShellCommand('go install golang.org/x/tools/...'), true);
  assert.equal(isGatedShellCommand('gem install rails'), true);
  assert.equal(isGatedShellCommand('composer install'), true);
  assert.equal(isGatedShellCommand('composer require monolog/monolog'), true);
  assert.equal(isGatedShellCommand('composer create-project laravel/laravel app'), true);
  assert.equal(isGatedShellCommand('deno add std/'), true);
  assert.equal(isGatedShellCommand('deno install npm:express'), true);
});

test('P2-4: 管道安装模式命中（curl|sh / wget|sh / iwr|iex）', () => {
  assert.equal(isGatedShellCommand('curl https://sh.rustup.rs | sh'), true);
  assert.equal(isGatedShellCommand('curl -fsSL https://get.docker.com | bash'), true);
  assert.equal(isGatedShellCommand('wget -qO- https://example.com/install.sh | sh'), true);
  assert.equal(isGatedShellCommand('wget https://example.com/setup.sh | bash'), true);
  assert.equal(isGatedShellCommand('iwr https://example.com/install.ps1 | iex'), true);
  assert.equal(isGatedShellCommand('invoke-webrequest https://example.com/install.ps1 | invoke-expression'), true);
});

test('P2-4: 其他生态包管理器命中（dotnet / mvn / gradle / rails / flutter / dart / bundle）', () => {
  assert.equal(isGatedShellCommand('dotnet new console'), true);
  assert.equal(isGatedShellCommand('dotnet add package Newtonsoft.Json'), true);
  assert.equal(isGatedShellCommand('mvn archetype:generate'), true);
  assert.equal(isGatedShellCommand('gradle init'), true);
  assert.equal(isGatedShellCommand('rails new myapp'), true);
  assert.equal(isGatedShellCommand('flutter create myapp'), true);
  assert.equal(isGatedShellCommand('flutter pub get'), true);
  assert.equal(isGatedShellCommand('dart pub get'), true);
  assert.equal(isGatedShellCommand('bundle install'), true);
  assert.equal(isGatedShellCommand('django-admin startproject mysite'), true);
});

test('P2-4: Tauri / create-tauri-app 命中', () => {
  assert.equal(isGatedShellCommand('create-tauri-app'), true);
  assert.equal(isGatedShellCommand('npm run tauri init'), true);
  assert.equal(isGatedShellCommand('npx tauri dev'), true);
});

test('P2-4: 非门禁命令不误报（普通命令放行）', () => {
  assert.equal(isGatedShellCommand('ls -la'), false);
  assert.equal(isGatedShellCommand('git status'), false);
  assert.equal(isGatedShellCommand('node script.js'), false);
  assert.equal(isGatedShellCommand('echo hello'), false);
  assert.equal(isGatedShellCommand('cat README.md'), false);
  assert.equal(isGatedShellCommand('mkdir build'), false);
  assert.equal(isGatedShellCommand('python app.py'), false);
  assert.equal(isGatedShellCommand('go run main.go'), false);
  assert.equal(isGatedShellCommand('cargo build'), false);
  assert.equal(isGatedShellCommand('cargo run'), false);
  assert.equal(isGatedShellCommand('cargo test'), false);
});

test('P2-4: 空命令/缺失参数返回 false', () => {
  assert.equal(isGatedShellCommand(''), false);
  assert.equal(isGatedShellCommand(null), false);
  assert.equal(isGatedShellCommand(undefined), false);
});
