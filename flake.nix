{
  description = "SuperLiora CLI";

  inputs = {
    # Pinned to the 25.11 release channel because nixpkgs-unstable currently
    # ships nodejs_24 = 24.14.1, which trips the >= 24.15.0 floor that the
    # native SEA build enforces (see apps/liora/scripts/native/build.mjs).
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
  };

  outputs =
    { self, nixpkgs }:
    let
      lib = nixpkgs.lib;

      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];

      forAllSystems =
        f:
        lib.genAttrs systems (
          system:
          f (import nixpkgs {
            inherit system;
          })
        );

      minNodeVersion = "24.15.0";

      # Hardcode to Node.js 24.x; fail the evaluation if the pinned nixpkgs
      # does not offer a new enough 24.x.
      nodejsFor =
        pkgs:
        let
          node = pkgs.nodejs_24;
        in
        if lib.versionAtLeast node.version minNodeVersion then
          node
        else
          throw ''
            SuperLiora requires Node.js >= ${minNodeVersion},
            but nixpkgs only offers ${node.version}.
            Pin a newer nixpkgs revision or update minNodeVersion in flake.nix.
          '';

      pnpmFor =
        pkgs:
        pkgs.pnpm_10.override {
          nodejs = nodejsFor pkgs;
        };

      # -------------------------------------------------------------------
      # Workspace members (kept in sync with pnpm-workspace.yaml).
      #
      # HARD REQUIREMENT: whenever you add or remove a workspace package,
      # you MUST update both lists below. Missing a path will break the Nix
      # build (src fileset silently drops files); missing a name will break
      # pnpmConfigHook (dependencies for that workspace won't be fetched).
      # -------------------------------------------------------------------
      workspacePaths = [
        ./packages/acp-adapter
        ./packages/agent-core
        ./packages/gui-use
        ./packages/server
        ./packages/server-e2e
        ./packages/kaos
        ./packages/kosong
        ./packages/migration-legacy
        ./packages/node-sdk
        ./packages/oauth
        ./packages/protocol
        ./packages/telemetry
        ./packages/tui-renderer
        ./apps/liora
        ./apps/vis
        ./apps/vis/server
        ./apps/vis/web
      ];

      workspaceNames = [
        "@superliora/acp-adapter"
        "@superliora/agent-core"
        "@superliora/gui-use"
        "@superliora/server"
        "@superliora/server-e2e"
        "@superliora/kaos"
        "@superliora/kosong"
        "@superliora/migration-legacy"
        "@superliora/sdk"
        "@superliora/oauth"
        "@superliora/protocol"
        "@superliora/telemetry"
        "@harness-kit/tui-renderer"
        "@superliora/liora"
        "@superliora/vis"
        "@superliora/vis-server"
        "@superliora/vis-web"
      ];
    in
    {
      packages = forAllSystems (
        pkgs:
        let
          nodejs = nodejsFor pkgs;
          pnpm = pnpmFor pkgs;
          appPackageJson = builtins.fromJSON (builtins.readFile ./apps/liora/package.json);
          nativeTarget =
            if pkgs.stdenv.hostPlatform.isLinux && pkgs.stdenv.hostPlatform.isAarch64 then
              "linux-arm64"
            else if pkgs.stdenv.hostPlatform.isLinux then
              "linux-x64"
            else if pkgs.stdenv.hostPlatform.isDarwin && pkgs.stdenv.hostPlatform.isAarch64 then
              "darwin-arm64"
            else if pkgs.stdenv.hostPlatform.isDarwin then
              "darwin-x64"
            else
              throw "Unsupported SuperLiora native target for ${pkgs.stdenv.hostPlatform.system}";

          liora = pkgs.stdenv.mkDerivation (finalAttrs: {
            pname = "liora";
            version = appPackageJson.version;

            src = lib.fileset.toSource {
              root = ./.;
              fileset = lib.fileset.unions (
                [
                  ./build
                  ./.npmrc
                  ./.nvmrc
                  ./package.json
                  ./pnpm-lock.yaml
                  ./pnpm-workspace.yaml
                  ./tsconfig.json
                  ./vitest.config.ts
                  ./LICENSE
                ]
                ++ workspacePaths
              );
            };

            pnpmWorkspaces = [ "." ] ++ workspaceNames;

            pnpmDeps = pkgs.fetchPnpmDeps {
              inherit (finalAttrs) pname version src pnpmWorkspaces;
              inherit pnpm;
              fetcherVersion = 3;
              hash = "sha256-oCkdhKgsSDxM9YuKmLjFm48/XQDGp+JuF1HvNNWcK0w=";
            };

            nativeBuildInputs = [
              nodejs
              pnpm
              (pkgs.pnpmConfigHook.override { inherit pnpm; })
              pkgs.makeWrapper
            ]
            # The SEA inject step (postject) invalidates the macOS code
            # signature on the copied Node executable; build.mjs then re-applies
            # an ad-hoc signature via `codesign`. The Nix darwin sandbox does
            # not expose /usr/bin/codesign, so we supply nixpkgs' ad-hoc-only
            # replacement instead.
            ++ lib.optionals pkgs.stdenv.hostPlatform.isDarwin [
              pkgs.darwin.sigtool
            ];

            # The SEA binary is produced by `postject`-injecting a blob into a
            # plain Node executable. Stripping rewrites section tables and can
            # invalidate the injected blob's offsets, so leave the binary
            # untouched after the build.
            dontStrip = true;

            buildPhase = ''
              runHook preBuild
              export SUPERLIORA_BUILD_TARGET=${nativeTarget}
              ${lib.optionalString pkgs.stdenv.hostPlatform.isDarwin ''
                # pkgs.darwin.sigtool's codesign supports `--sign -` (ad-hoc)
                # but not the inspection mode (`-dv`) that 05-verify.mjs runs
                # afterwards. Disable the verify step for the Nix build; the
                # release CI keeps it via the unmodified script.
                substituteInPlace apps/liora/scripts/native/build.mjs \
                  --replace-fail \
                    "await runVerifyStep({ requireGatekeeper: false });" \
                    "// runVerifyStep skipped in nix sandbox (sigtool lacks -dv)"
              ''}
              substituteInPlace apps/liora/scripts/build-vis-asset.mjs \
                --replace-fail \
                  "corepack pnpm --filter @superliora/vis-web exec vite build" \
                  "pnpm --filter @superliora/vis-web exec vite build"
              pnpm --filter=@superliora/liora run build:native:sea
              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall

              install -Dm755 \
                "apps/liora/dist-native/bin/${nativeTarget}/liora" \
                "$out/bin/liora"

              runHook postInstall
            '';

            postInstall = ''
              wrapProgram $out/bin/liora --prefix PATH : ${lib.makeBinPath [ pkgs.ripgrep pkgs.fd ]}
            '';

            meta = {
              description = "SuperLiora CLI";
              homepage = "https://github.com/claudianus/superliora";
              license = lib.licenses.mit;
              mainProgram = "liora";
              platforms = systems;
            };
          });
        in
        {
          inherit liora;
          default = liora;
        }
      );

      apps = forAllSystems (pkgs: {
        liora = {
          type = "app";
          program = "${self.packages.${pkgs.system}.liora}/bin/liora";
        };
        default = self.apps.${pkgs.system}.liora;
      });

      devShells = forAllSystems (pkgs: {
        default =
          let
            nodejs = nodejsFor pkgs;
            pnpm = pnpmFor pkgs;
          in
          pkgs.mkShell {
            packages = [
              nodejs
              pnpm
              pkgs.ripgrep
              pkgs.fd
            ];
          };
      });
    };
}
