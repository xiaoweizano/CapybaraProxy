use crate::{platform_error, PlatformError, PlatformErrorKind};
use std::path::Path;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StartupState {
    Enabled,
    Disabled,
    Conflict,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StartupStatus {
    pub state: StartupState,
    pub command: Option<String>,
    pub expected_command: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StartupActionOutcome {
    Changed(StartupStatus),
    Unchanged(StartupStatus),
    Conflict(StartupStatus),
}

pub trait StartupBackend {
    fn read_command(&mut self) -> Result<Option<String>, PlatformError>;
    fn write_command(&mut self, command: &str) -> Result<(), PlatformError>;
    fn remove_command(&mut self) -> Result<(), PlatformError>;
}

pub struct StartupManager<B> {
    backend: B,
}

impl<B> StartupManager<B>
where
    B: StartupBackend,
{
    pub fn new(backend: B) -> Self {
        Self { backend }
    }

    pub fn status(&mut self, executable: &Path) -> Result<StartupStatus, PlatformError> {
        let expected_command = expected_startup_command(executable)?;
        let command = self.backend.read_command()?;
        let state = match command.as_deref() {
            None => StartupState::Disabled,
            Some(command) if command == expected_command => StartupState::Enabled,
            Some(_) => StartupState::Conflict,
        };
        Ok(StartupStatus {
            state,
            command,
            expected_command,
        })
    }

    pub fn enable(&mut self, executable: &Path) -> Result<StartupActionOutcome, PlatformError> {
        let status = self.status(executable)?;
        match status.state {
            StartupState::Enabled => Ok(StartupActionOutcome::Unchanged(status)),
            StartupState::Conflict => Ok(StartupActionOutcome::Conflict(status)),
            StartupState::Disabled => {
                self.backend.write_command(&status.expected_command)?;
                let status = self.status(executable)?;
                Ok(StartupActionOutcome::Changed(status))
            }
        }
    }

    pub fn disable(&mut self, executable: &Path) -> Result<StartupActionOutcome, PlatformError> {
        let status = self.status(executable)?;
        match status.state {
            StartupState::Disabled => Ok(StartupActionOutcome::Unchanged(status)),
            StartupState::Conflict => Ok(StartupActionOutcome::Conflict(status)),
            StartupState::Enabled => {
                self.backend.remove_command()?;
                let status = self.status(executable)?;
                Ok(StartupActionOutcome::Changed(status))
            }
        }
    }
}

pub fn expected_startup_command(executable: &Path) -> Result<String, PlatformError> {
    let extension_is_exe = executable
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"));
    let rendered = executable.as_os_str().to_string_lossy();
    if !executable.is_absolute()
        || !extension_is_exe
        || rendered.contains('"')
        || rendered.contains('\0')
    {
        return Err(platform_error(
            PlatformErrorKind::InvalidExecutablePath,
            "The FlowProxy startup path must be an absolute Windows executable path.",
        ));
    }

    Ok(format!("\"{rendered}\""))
}

#[cfg(test)]
mod tests {
    use super::{
        expected_startup_command, StartupActionOutcome, StartupBackend, StartupManager,
        StartupState,
    };
    use crate::{PlatformError, PlatformErrorKind};
    use std::cell::RefCell;
    use std::path::Path;
    use std::rc::Rc;

    #[derive(Clone, Default)]
    struct FakeStartupBackend {
        command: Rc<RefCell<Option<String>>>,
    }

    impl FakeStartupBackend {
        fn with_command(command: Option<String>) -> Self {
            Self {
                command: Rc::new(RefCell::new(command)),
            }
        }

        fn command(&self) -> Option<String> {
            self.command.borrow().clone()
        }
    }

    impl StartupBackend for FakeStartupBackend {
        fn read_command(&mut self) -> Result<Option<String>, PlatformError> {
            Ok(self.command())
        }

        fn write_command(&mut self, command: &str) -> Result<(), PlatformError> {
            *self.command.borrow_mut() = Some(command.to_owned());
            Ok(())
        }

        fn remove_command(&mut self) -> Result<(), PlatformError> {
            *self.command.borrow_mut() = None;
            Ok(())
        }
    }

    #[test]
    fn startup_command_is_one_quoted_absolute_executable_path() {
        let command =
            expected_startup_command(Path::new(r"C:\Program Files\FlowProxy\FlowProxy.exe"))
                .expect("absolute executable path is accepted");

        assert_eq!(command, r#""C:\Program Files\FlowProxy\FlowProxy.exe""#);
    }

    #[test]
    fn startup_enable_is_idempotent_for_the_exact_command() {
        let executable = Path::new(r"C:\Program Files\FlowProxy\FlowProxy.exe");
        let backend = FakeStartupBackend::default();
        let mut manager = StartupManager::new(backend.clone());

        let first = manager.enable(executable).expect("enable launch at login");
        let second = manager.enable(executable).expect("repeat launch at login");

        assert!(matches!(first, StartupActionOutcome::Changed(_)));
        assert!(matches!(second, StartupActionOutcome::Unchanged(_)));
        assert_eq!(
            backend.command().as_deref(),
            Some(r#""C:\Program Files\FlowProxy\FlowProxy.exe""#)
        );
    }

    #[test]
    fn startup_disable_preserves_a_foreign_same_name_command() {
        let executable = Path::new(r"C:\Program Files\FlowProxy\FlowProxy.exe");
        let foreign = r#""C:\Other\Tool.exe" --background"#.to_owned();
        let backend = FakeStartupBackend::with_command(Some(foreign.clone()));
        let mut manager = StartupManager::new(backend.clone());

        let status = manager
            .status(executable)
            .expect("read launch at login status");
        let outcome = manager
            .disable(executable)
            .expect("disable launch at login");

        assert_eq!(status.state, StartupState::Conflict);
        assert!(matches!(outcome, StartupActionOutcome::Conflict(_)));
        assert_eq!(backend.command(), Some(foreign));
    }

    #[test]
    fn invalid_executable_path_is_rejected_without_mutating_startup() {
        let backend = FakeStartupBackend::default();
        let mut manager = StartupManager::new(backend.clone());

        let error = manager
            .enable(Path::new(r"relative\FlowProxy.exe"))
            .expect_err("relative executable path must be rejected");

        assert_eq!(error.kind, PlatformErrorKind::InvalidExecutablePath);
        assert_eq!(backend.command(), None);
    }
}
