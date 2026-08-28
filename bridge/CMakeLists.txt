# ---------------------------------------------------------------------------
#  Beacon Bridge — the native plug-in host that lets Beacon load AU and VST3.
#
#    cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=Release
#    cmake --build build
#
#  JUCE is found in this order:
#    1. -DJUCE_PATH=/path/to/JUCE
#    2. the copy vendored with the Luz plug-in, if it is there
#    3. downloaded with FetchContent
# ---------------------------------------------------------------------------
cmake_minimum_required(VERSION 3.22)

project(BeaconBridge VERSION 1.0.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_OSX_DEPLOYMENT_TARGET "11.0" CACHE STRING "Minimum macOS version")
set(CMAKE_OSX_ARCHITECTURES "arm64;x86_64" CACHE STRING "Build architectures")

set(JUCE_PATH "" CACHE PATH "Path to a JUCE checkout")

if(JUCE_PATH AND EXISTS "${JUCE_PATH}/CMakeLists.txt")
    message(STATUS "Beacon Bridge: using JUCE at ${JUCE_PATH}")
    add_subdirectory("${JUCE_PATH}" juce-build)
elseif(EXISTS "$ENV{HOME}/Desktop/Plugins/Luz/vendor/JUCE/CMakeLists.txt")
    message(STATUS "Beacon Bridge: using the JUCE vendored with Luz")
    add_subdirectory("$ENV{HOME}/Desktop/Plugins/Luz/vendor/JUCE" juce-build)
else()
    message(STATUS "Beacon Bridge: fetching JUCE")
    include(FetchContent)
    FetchContent_Declare(JUCE
        GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
        GIT_TAG        8.0.10
        GIT_SHALLOW    TRUE)
    FetchContent_MakeAvailable(JUCE)
endif()

juce_add_gui_app(BeaconBridge
    PRODUCT_NAME        "Beacon Bridge"
    COMPANY_NAME        "100Lights"
    BUNDLE_ID           "com.hundredlights.beacon.bridge"
    VERSION             "1.0.0"
    # Loading a plug-in means loading code that may want the microphone.
    MICROPHONE_PERMISSION_ENABLED TRUE
    MICROPHONE_PERMISSION_TEXT
        "Some plug-ins record audio. Beacon Bridge asks on their behalf."
    # Keeps it out of the Dock: it is infrastructure, not something you switch to.
    # Comment this out while debugging if you want the window in the Dock.
    DOCUMENT_EXTENSIONS ""
)

target_sources(BeaconBridge PRIVATE
    src/Main.cpp
    src/PluginHost.cpp
    src/WebSocketServer.cpp
)

target_compile_definitions(BeaconBridge PUBLIC
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_DISPLAY_SPLASH_SCREEN=0
    JUCE_REPORT_APP_USAGE=0
    JUCE_STRICT_REFCOUNTEDPOINTER=1

    # Hosting. AU on macOS, VST3 everywhere. There is deliberately no VST2:
    # it needs Steinberg's withdrawn SDK and cannot be shipped.
    JUCE_PLUGINHOST_AU=1
    JUCE_PLUGINHOST_VST3=1
    JUCE_PLUGINHOST_VST=0
    JUCE_PLUGINHOST_LADSPA=0

    JUCE_APPLICATION_NAME_STRING="Beacon Bridge"
    JUCE_APPLICATION_VERSION_STRING="1.0.0"
)

target_link_libraries(BeaconBridge PRIVATE
    juce::juce_audio_processors
    juce::juce_audio_utils
    juce::juce_gui_extra
    PUBLIC
    juce::juce_recommended_config_flags
    juce::juce_recommended_lto_flags
    juce::juce_recommended_warning_flags
)
