//! Núcleo do Seedy.
//!
//! Cada módulo cuida de uma parte do sistema e expõe comandos para a interface
//! (Angular) via `invoke`. A regra é manter o núcleo pequeno: só o que precisa
//! de acesso ao sistema (arquivos, busca, processos, PTY, Git, banco, servidores) mora aqui.

mod arquivos;
mod arquitetura;
mod banco;
mod busca;
mod containers;
mod depurador;
mod git;
mod ia;
mod java;
mod mcp;
mod novo_projeto;
mod observador;
mod servidor;
mod terminal;
mod testes;
mod web;
mod tema;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(terminal::Terminais::default())
        .manage(java::Servidores::default())
        .manage(observador::Observador::default())
        .manage(git::ContaGithub::default())
        .manage(banco::Bancos::default())
        .manage(servidor::Execucoes::default())
        .manage(depurador::SessoesDap::default())
        .manage(mcp::Mcp::default())
        .manage(web::Tarefas::default())
        .manage(web::JsDebug::default())
        .setup(|app| {
            tema::garantir_tema_padrao().map_err(|e| e.to_string())?;
            tema::observar(app.handle().clone());
            {
                use tauri::Manager;
                mcp::iniciar(app.handle().clone(), app.state::<mcp::Mcp>().inner());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            arquivos::pasta_inicial,
            arquivos::ler_pasta,
            arquivos::ler_arquivo,
            arquivos::gravar_arquivo,
            arquitetura::arquitetura_analisar,
            testes::testes_relatorios,
            testes::testes_comando,
            busca::busca_indexar,
            busca::busca_texto,
            git::branch_atual,
            git::git,
            git::github_conta,
            git::github_token,
            git::github_desconectar,
            git::github_repositorios,
            git::github_api,
            git::abrir_no_navegador,
            ia::ia_tem_chave,
            ia::ia_definir_chave,
            ia::ia_esquecer_chave,
            ia::ia_mensagem,
            ia::ia_claude_estado,
            banco::banco_perfis,
            banco::banco_salvar_perfil,
            banco::banco_apagar_perfil,
            banco::banco_tem_senha,
            banco::banco_conectar,
            banco::banco_desconectar,
            banco::banco_conectados,
            banco::banco_consultar,
            banco::banco_exportar_csv,
            banco::banco_catalogo,
            banco::banco_colunas,
            banco::banco_historico,
            banco::banco_console,
            servidor::servidor_perfis,
            servidor::servidor_salvar_perfil,
            servidor::servidor_apagar_perfil,
            servidor::servidor_inspecionar,
            servidor::servidor_iniciar,
            servidor::servidor_parar,
            servidor::servidor_redeploy,
            servidor::servidor_em_execucao,
            servidor::servidor_abrir_url,
            servidor::servidor_http,
            depurador::java_debug_plugin,
            depurador::dap_conectar,
            depurador::dap_enviar,
            depurador::dap_fechar,
            mcp::mcp_info,
            mcp::mcp_definir_ferramentas,
            mcp::mcp_responder,
            novo_projeto::projeto_criar,
            novo_projeto::spring_metadados,
            web::web_estado,
            web::web_instalar,
            web::lsp_web_iniciar,
            web::web_formatar,
            web::tarefa_iniciar,
            web::tarefa_parar,
            web::jsdebug_iniciar,
            web::web_navegadores,
            containers::docker_versao,
            containers::docker_listar,
            containers::docker_trafego,
            containers::docker_uso,
            containers::docker_acao,
            observador::projeto_observar,
            java::java_estado,
            java::java_jdks,
            java::jdtls_instalar,
            java::lsp_iniciar,
            java::lsp_enviar,
            java::lsp_parar,
            tema::tema_carregar,
            tema::config_carregar,
            tema::config_padrao,
            tema::tema_padrao,
            tema::fonte_bytes,
            terminal::terminal_abrir,
            terminal::terminal_escrever,
            terminal::terminal_redimensionar,
            terminal::terminal_fechar,
        ])
        .build(tauri::generate_context!())
        .expect("erro ao iniciar o Seedy")
        .run(|app, evento| {
            // Fechou o Seedy: os servidores de aplicação não ficam rodando sozinhos.
            if let tauri::RunEvent::Exit = evento {
                use tauri::Manager;
                app.state::<servidor::Execucoes>().encerrar_todos();
                app.state::<web::Tarefas>().encerrar_todas();
                app.state::<web::JsDebug>().encerrar();
            }
        });
}
