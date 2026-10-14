use anyhow::Result;
use serde::Deserialize;
use std::path::Path;

use rust_embed::Embed;

#[derive(Embed, Debug)]
#[folder = ""]
#[include = "config.toml"]
pub struct Assets;

#[derive(Embed, Debug)]
#[folder = "dist"]
pub struct Dist;

#[derive(Embed, Debug)]
#[folder = "../themes"]
pub struct Themes;

#[derive(Debug, Deserialize, Clone)]
#[allow(dead_code)]
pub struct Config {
    pub theme: String,
    pub language: Vec<Language>,
    pub terminal: Option<Terminal>,
}

impl Config {
    #[allow(dead_code)]
    pub fn default() -> Self {
        Config {
            theme: "default".to_string(),
            language: vec![],
            terminal: None,
        }
    }
}

#[derive(Debug, Deserialize, Clone)]
#[allow(dead_code)]
pub struct Language {
    pub name: String,
    pub types: Vec<String>,
    pub comment: String,
    pub lsp: Option<Vec<String>>,
    pub indent: IndentConfig,
    pub executable: Option<bool>,
    pub exec: Option<String>,
    pub exectest: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
#[allow(dead_code)]
pub struct IndentConfig {
    pub width: i32,
    pub unit: String,
}

#[cfg(test)]
pub fn get_config(conf_path: &str) -> Config {
    let error_message = format!("Unable to read config.toml file from path {}", conf_path);
    let toml_str = std::fs::read_to_string(conf_path).expect(&error_message);
    let config: Config = toml::from_str(&toml_str).expect("Unable to parse TOML");
    config
}

pub fn get() -> Config {
    // check ANYCODE_HOME/config.toml first
    let toml_str = match std::env::var("ANYCODE_HOME") {
        Ok(home) => {
            let config_path = Path::new(&home).join("config.toml");
            match std::fs::read_to_string(config_path) {
                Ok(toml_str) => toml_str,
                Err(_) => read_assets_config().unwrap_or_default(),
            }
        }
        Err(_) => {
            // checkout ~/.anycode/config.toml
            if let Some(home) = dirs::home_dir() {
                let config_path = home.join(".anycode").join("config.toml");
                match std::fs::read_to_string(config_path) {
                    Ok(toml_str) => toml_str,
                    Err(_) => read_assets_config().unwrap_or_default(),
                }
            } else {
                eprintln!("Couldn't find home directory");
                read_assets_config().unwrap_or_default()
            }
        }
    };

    let config: Config = toml::from_str(&toml_str).expect("Unable to parse TOML");
    config
}

pub fn read_assets_config() -> anyhow::Result<String> {
    let config = Assets::get("config.toml")
        .ok_or_else(|| anyhow::anyhow!("Missing embedded file: config.toml"))?;
    let config_str = std::str::from_utf8(&config.data)
        .map_err(|e| anyhow::anyhow!("Invalid UTF-8 in config.toml: {}", e))?;
    Ok(config_str.to_string())
}

#[derive(Debug, Deserialize, Clone)]
#[allow(dead_code)]
pub struct Terminal {
    pub command: String,
}

const DEFAULT_PORT: u16 = 3000;

fn print_help() {
    println!("anycode - Code editor server");
    println!();
    println!("USAGE:");
    println!("    anycode [OPTIONS]");
    println!();
    println!("OPTIONS:");
    println!("    -h, --help           Print help information");
    println!("    -v, -V, --version    Print version information");
    println!("    -p, --port <PORT>    Port to listen on (default: 3000)");
    println!("    -t, --token <TOKEN>  Require authentication token to access anycode");
    println!();
    println!("ENVIRONMENT:");
    println!("    ANYCODE_PORT                  Port to listen on (default: 3000)");
    println!("    ANYCODE_TOKEN                 Require authentication token to access anycode");
    println!("    ANYCODE_HOME                  Path to configuration directory");
    println!("    ANYCODE_ACP_PERMISSION_MODE   ACP permission mode: full_access (default) or ask");
    println!();
    println!("Start the anycode server. The server will be available at http://localhost:<port>");
}

pub fn handle_early_cli_flags() {
    let mut args = std::env::args().skip(1);

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--help" | "-h" => {
                print_help();
                std::process::exit(0);
            }
            "--version" | "-V" | "-v" => {
                println!("anycode {}", env!("CARGO_PKG_VERSION"));
                std::process::exit(0);
            }
            "--port" | "-p" => {
                // Skip value for port flag in early pass.
                let _ = args.next();
            }
            "--token" | "-t" => {
                // Skip value for token flag in early pass.
                let _ = args.next();
            }
            _ => {}
        }
    }
}

fn parse_port(value: &str, source: &str) -> Result<u16> {
    value
        .parse::<u16>()
        .map_err(|_| anyhow::anyhow!("Invalid {source}: {value}"))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerOptions {
    pub port: u16,
    pub token: Option<String>,
}

pub fn parse_server_options_from_iter_and_env<I, F>(mut args: I, get_env: F) -> Result<ServerOptions>
where
    I: Iterator<Item = String>,
    F: Fn(&str) -> Result<String, std::env::VarError>,
{
    let mut cli_port: Option<u16> = None;
    let mut cli_token: Option<String> = None;

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--help" | "-h" => {
                print_help();
                std::process::exit(0);
            }
            "--version" | "-V" | "-v" => {
                println!("anycode {}", env!("CARGO_PKG_VERSION"));
                std::process::exit(0);
            }
            "--port" | "-p" => {
                let value = args
                    .next()
                    .ok_or_else(|| anyhow::anyhow!("Missing value for {arg}"))?;
                cli_port = Some(parse_port(&value, "CLI port")?);
            }
            _ if arg.starts_with("--port=") => {
                cli_port = Some(parse_port(&arg["--port=".len()..], "CLI port")?);
            }
            "--token" | "-t" => {
                let value = args
                    .next()
                    .ok_or_else(|| anyhow::anyhow!("Missing value for {arg}"))?;
                cli_token = Some(value);
            }
            _ if arg.starts_with("--token=") => {
                cli_token = Some(arg["--token=".len()..].to_string());
            }
            _ if arg.starts_with('-') => {
                anyhow::bail!("Unknown option: {arg}");
            }
            _ => {
                anyhow::bail!("Unknown positional argument: {arg}");
            }
        }
    }

    let port = if let Some(port) = cli_port {
        port
    } else {
        match get_env("ANYCODE_PORT") {
            Ok(value) => parse_port(&value, "ANYCODE_PORT")?,
            Err(_) => DEFAULT_PORT,
        }
    };

    let token = cli_token
        .or_else(|| get_env("ANYCODE_TOKEN").ok())
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty());

    Ok(ServerOptions { port, token })
}

pub fn parse_server_options_from_iter<I>(args: I) -> Result<ServerOptions>
where
    I: Iterator<Item = String>,
{
    parse_server_options_from_iter_and_env(args, |k| std::env::var(k))
}

pub fn resolve_server_options() -> Result<ServerOptions> {
    parse_server_options_from_iter(std::env::args().skip(1))
}

#[allow(dead_code)]
pub fn resolve_server_port() -> Result<u16> {
    resolve_server_options().map(|opts| opts.port)
}

#[cfg(test)]
mod congif_tests {
    use super::*;

    #[test]
    fn test_read_config() {
        let config = crate::config::get_config("./config.toml");

        println!("Theme: {}", config.theme);
        println!();

        for language in config.language {
            println!("Language: {}", language.name);
            println!("File Types: {:?}", language.types);
            println!("Comment Token: {}", language.comment);
            println!("LSP: {:?}", language.lsp);
            println!("Indent: {:?}", language.indent);
            println!();
        }
    }

    #[test]
    fn test_assets() {
        // let config = Asset::get("config.toml").unwrap();
        // println!("{:?}", std::str::from_utf8(config.data.as_ref()));

        for file in Dist::iter() {
            println!("{}", file.as_ref());
        }
    }

    #[test]
    fn test_themes() {
        assert!(Themes::iter().count() > 0);
        let default_theme =
            Themes::get("default-theme.json").expect("default-theme.json should be embedded");
        let content = std::str::from_utf8(default_theme.data.as_ref()).unwrap();
        assert!(content.contains("themes"));
    }

    #[test]
    fn test_parse_server_options_defaults() {
        let opts = parse_server_options_from_iter_and_env(std::iter::empty(), |_| {
            Err(std::env::VarError::NotPresent)
        })
        .unwrap();
        assert_eq!(opts.port, 3000);
        assert_eq!(opts.token, None);
    }

    #[test]
    fn test_parse_server_options_with_token_and_port() {
        let args = vec![
            "-p".to_string(),
            "8080".to_string(),
            "--token".to_string(),
            "secret123".to_string(),
        ];
        let opts = parse_server_options_from_iter_and_env(args.into_iter(), |_| {
            Err(std::env::VarError::NotPresent)
        })
        .unwrap();
        assert_eq!(opts.port, 8080);
        assert_eq!(opts.token, Some("secret123".to_string()));
    }

    #[test]
    fn test_parse_server_options_with_short_token_flag() {
        let args = vec!["-t".to_string(), "abc".to_string()];
        let opts = parse_server_options_from_iter_and_env(args.into_iter(), |_| {
            Err(std::env::VarError::NotPresent)
        })
        .unwrap();
        assert_eq!(opts.token, Some("abc".to_string()));
    }

    #[test]
    fn test_parse_server_options_from_mock_env() {
        let opts = parse_server_options_from_iter_and_env(std::iter::empty(), |var| match var {
            "ANYCODE_PORT" => Ok("4567".to_string()),
            "ANYCODE_TOKEN" => Ok("my_env_token".to_string()),
            _ => Err(std::env::VarError::NotPresent),
        })
        .unwrap();
        assert_eq!(opts.port, 4567);
        assert_eq!(opts.token, Some("my_env_token".to_string()));
    }
}
