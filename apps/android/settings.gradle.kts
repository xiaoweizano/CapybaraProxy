pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "FlowProxyAndroid"
include(":core-model")
include(":core-theme")
include(":core-data")
include(":mihomo-bridge")
include(":vpn-service")
include(":app")
